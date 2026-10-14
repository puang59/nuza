//! JSON-RPC 2.0 over an agent's stdin and stdout, which is all ACP (the Agent
//! Client Protocol) is on the wire: one JSON object per line each way, our
//! requests matched to their responses by id, and everything else the agent
//! sends routed by method name.
//!
//! Hand-rolled rather than taken from an ACP crate. nuza needs a handful of
//! methods, the protocol is still moving, and a client this small can be
//! tested against `scripts/mock-acp-agent.mjs` with no agent installed. The
//! wire shapes it expects are the ones in `docs/acp-transcript.md`, taken from
//! real agents rather than from the specification.

use std::collections::{HashMap, VecDeque};
use std::process::Stdio;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::{mpsc, oneshot, Mutex as AsyncMutex};

use crate::state::locked;

/// How much of what the agent last printed on stderr is kept to explain its
/// exit: enough for "npm error EACCES" and the line after it, not the whole
/// stream.
const STDERR_TAIL_LINES: usize = 6;
const STDERR_LINE_CHARS: usize = 300;

/// How long a dead agent's stderr is given to arrive before its requests are
/// failed. Its last words are usually the reason, and they come after stdout
/// has already closed.
const STDERR_GRACE: Duration = Duration::from_millis(150);

/// JSON-RPC's "method not found", which is the answer to anything the agent
/// asks of us that nuza does not serve.
const METHOD_NOT_FOUND: i64 = -32601;

/// Something the agent said that was not an answer to us: a notification, or
/// a request of its own that has already been refused.
#[derive(Debug, Clone)]
pub(crate) struct Inbound {
    pub(crate) method: String,
    pub(crate) params: Value,
}

pub(crate) type InboundSender = mpsc::UnboundedSender<Inbound>;

/// Decides which of the agent's permission requests are allowed. Everything
/// is refused unless a gate says otherwise, and no gate is asked about
/// anything but a permission: the file system and the terminal are not
/// offered at all.
pub(crate) trait Gate: Send + Sync {
    /// Sees each `session/update` before it is passed on. The permission for
    /// a tool call names the call by id alone; what it is a call *to* is only
    /// said in the update that announced it.
    fn saw(&self, _update: &Value) {}

    /// Whether this permission request may be allowed, once.
    fn allows(&self, request: &Value) -> bool;
}

/// The gate that allows nothing.
#[cfg(test)]
pub(crate) struct RefuseAll;

#[cfg(test)]
impl Gate for RefuseAll {
    fn allows(&self, _: &Value) -> bool {
        false
    }
}

type Reply = Result<Value, String>;
type Pending = Arc<Mutex<HashMap<i64, oneshot::Sender<Reply>>>>;
type StderrTail = Arc<Mutex<VecDeque<String>>>;

/// A running agent and the conversation with it.
pub(crate) struct RpcClient {
    child: AsyncMutex<Child>,
    stdin: Arc<AsyncMutex<ChildStdin>>,
    next_id: AtomicI64,
    pending: Pending,
}

impl RpcClient {
    /// Starts `command` and listens to it. Notifications, and the requests
    /// the agent makes of us once they have been refused, go to `inbound`.
    /// `gate` says which permissions are not refused.
    pub(crate) fn spawn(
        mut command: Command,
        inbound: InboundSender,
        gate: Arc<dyn Gate>,
    ) -> std::io::Result<Self> {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // An agent must not outlive the app. This covers the agent itself;
            // the process group below covers what it starts.
            .kill_on_drop(true);

        // `npx` runs the adapter as a child of its own, so killing the process
        // nuza started would leave the adapter behind. In a group of its own,
        // everything it starts can be killed together.
        #[cfg(unix)]
        command.process_group(0);

        let mut child = command.spawn()?;
        let stdin = Arc::new(AsyncMutex::new(child.stdin.take().expect("stdin is piped")));
        let stdout = child.stdout.take().expect("stdout is piped");
        let stderr = child.stderr.take().expect("stderr is piped");

        let pending = Pending::default();
        let tail = StderrTail::default();
        read_stderr(stderr, Arc::clone(&tail));
        read_stdout(
            stdout,
            Arc::clone(&pending),
            Arc::clone(&stdin),
            inbound,
            gate,
            tail,
        );

        Ok(Self {
            child: AsyncMutex::new(child),
            stdin,
            next_id: AtomicI64::new(1),
            pending,
        })
    }

    /// Sends a request and waits for the agent's answer to it.
    pub(crate) async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, answer) = oneshot::channel();
        locked(&self.pending).insert(id, sender);

        let message = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        if let Err(error) = write_line(&self.stdin, &message).await {
            locked(&self.pending).remove(&id);
            return Err(format!("could not write to the agent: {error}"));
        }

        answer
            .await
            .map_err(|_| "the agent closed before responding".to_string())?
    }

    /// Sends a notification, which the agent does not answer.
    pub(crate) async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let message = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        write_line(&self.stdin, &message)
            .await
            .map_err(|error| format!("could not write to the agent: {error}"))
    }

    /// Whether the agent has already exited.
    pub(crate) async fn has_exited(&self) -> bool {
        matches!(self.child.lock().await.try_wait(), Ok(Some(_)))
    }

    /// Stops the agent and everything it started, without waiting - for an
    /// app on its way out, which has no time to.
    pub(crate) fn kill_now(&self) {
        if let Ok(mut child) = self.child.try_lock() {
            kill_group(&mut child);
            let _ = child.start_kill();
        }
    }

    /// Stops the agent, and everything it started.
    pub(crate) async fn kill(&self) {
        let mut child = self.child.lock().await;
        kill_group(&mut child);
        let _ = child.kill().await;
    }
}

impl Drop for RpcClient {
    /// `kill_on_drop` reaches the agent itself; this reaches its children.
    fn drop(&mut self) {
        kill_group(self.child.get_mut());
    }
}

/// Kills the process group the agent leads, while it is still the agent's.
///
/// Only before the agent has been reaped: until then its process id - which
/// is the group's id - cannot have been handed to anything else, and after it
/// a signal to that id could reach some other program entirely.
#[cfg(unix)]
fn kill_group(child: &mut Child) {
    if !matches!(child.try_wait(), Ok(None)) {
        return;
    }
    if let Some(group) = child.id().and_then(|pid| libc::pid_t::try_from(pid).ok()) {
        // SAFETY: killpg only sends a signal, to a group the agent was started
        // in and still leads, which holds nothing but what it started.
        unsafe {
            libc::killpg(group, libc::SIGKILL);
        }
    }
}

#[cfg(not(unix))]
fn kill_group(_: &mut Child) {}

async fn write_line(stdin: &AsyncMutex<ChildStdin>, message: &Value) -> std::io::Result<()> {
    let mut line = serde_json::to_vec(message).expect("a Value always serializes");
    line.push(b'\n');
    let mut stdin = stdin.lock().await;
    stdin.write_all(&line).await?;
    stdin.flush().await
}

fn read_stdout(
    stdout: ChildStdout,
    pending: Pending,
    stdin: Arc<AsyncMutex<ChildStdin>>,
    inbound: InboundSender,
    gate: Arc<dyn Gate>,
    tail: StderrTail,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            // Agents and their plugins print other things on stdout - a
            // banner, a log line - and none of it is the protocol.
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                if !line.trim().is_empty() {
                    log::debug!("agent stdout, not JSON-RPC: {line}");
                }
                continue;
            };
            let method = message.get("method").and_then(Value::as_str);
            let id = message.get("id").filter(|id| !id.is_null());

            match (id, method) {
                (Some(id), None) => answer_pending(&pending, id, &message),
                (Some(id), Some(method)) => {
                    // A request of the agent's own. It is always answered,
                    // because an agent waiting on a reply that never comes
                    // looks exactly like a model that has hung.
                    let params = message.get("params").cloned().unwrap_or(Value::Null);
                    let (reply, allowed) = reply_to_agent(method, id.clone(), &params, &*gate);
                    if let Err(error) = write_line(&stdin, &reply).await {
                        log::warn!("could not answer the agent's {method}: {error}");
                    }
                    // What was allowed is not news. What was refused is passed
                    // on, so it can be said rather than silently not happen.
                    if !allowed {
                        let _ = inbound.send(Inbound {
                            method: method.to_string(),
                            params,
                        });
                    }
                }
                (None, Some(method)) => {
                    let params = message.get("params").cloned().unwrap_or(Value::Null);
                    if method == "session/update" {
                        gate.saw(&params);
                    }
                    let _ = inbound.send(Inbound {
                        method: method.to_string(),
                        params,
                    });
                }
                (None, None) => {}
            }
        }

        eprintln!("DBG stdout EOF");
        // Stdout has closed, so the agent has exited or is about to. Nothing
        // that is waiting will ever be answered: fail it, with the reason.
        tokio::time::sleep(STDERR_GRACE).await;
        let reason = exit_reason(&tail);
        for (_, waiting) in locked(&pending).drain() {
            let _ = waiting.send(Err(reason.clone()));
        }
    });
}

/// Hands an answer to whoever asked for it.
fn answer_pending(pending: &Pending, id: &Value, message: &Value) {
    let Some(id) = id.as_i64() else { return };
    let Some(waiting) = locked(pending).remove(&id) else {
        return;
    };
    let answer = match message.get("error") {
        Some(error) => Err(error_text(error)),
        None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
    };
    let _ = waiting.send(answer);
}

/// What an agent's error says. Some put the real reason under
/// `data.details` and nothing but "Internal error" in the message, so both
/// are kept: "Internal error: Invalid Mode", not "Internal error".
pub(crate) fn error_text(error: &Value) -> String {
    let message = error.get("message").and_then(Value::as_str);
    let details = error.pointer("/data/details").and_then(Value::as_str);
    match (message, details) {
        (Some(message), Some(details)) => format!("{message}: {details}"),
        (Some(message), None) => message.to_string(),
        (None, Some(details)) => details.to_string(),
        (None, None) => error.to_string(),
    }
}

/// The answer to a request from the agent, and whether it was a yes.
///
/// nuza offers the agent nothing to ask for: no file system and no terminal
/// are advertised at `initialize`, so anything but a permission request is a
/// method nuza does not have. A permission is refused unless `gate` allows it
/// and the agent offered a way to allow it just this once - never "always".
/// The id is echoed back exactly as it came, whatever its type.
pub(crate) fn reply_to_agent(
    method: &str,
    id: Value,
    params: &Value,
    gate: &dyn Gate,
) -> (Value, bool) {
    if method != "session/request_permission" {
        let reply = json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": METHOD_NOT_FOUND, "message": format!("method not supported: {method}") },
        });
        return (reply, false);
    }
    let allow_once = gate
        .allows(params)
        .then(|| params.get("options")?.as_array())
        .flatten()
        .and_then(|options| {
            options
                .iter()
                .find(|option| option.get("kind").and_then(Value::as_str) == Some("allow_once"))
        })
        .and_then(|option| option.get("optionId").cloned());
    match allow_once {
        Some(option) => (
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "outcome": { "outcome": "selected", "optionId": option } },
            }),
            true,
        ),
        None => (
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "outcome": { "outcome": "cancelled" } },
            }),
            false,
        ),
    }
}

fn read_stderr(stderr: ChildStderr, tail: StderrTail) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            // For diagnosis only. What an agent prints here is not protocol,
            // and is never parsed for meaning.
            log::debug!("agent: {line}");
            remember_stderr(&tail, &line);
        }
    });
}

fn remember_stderr(tail: &StderrTail, line: &str) {
    let line = line.trim();
    if line.is_empty() {
        return;
    }
    let mut tail = locked(tail);
    if tail.len() == STDERR_TAIL_LINES {
        tail.pop_front();
    }
    tail.push_back(line.chars().take(STDERR_LINE_CHARS).collect());
}

/// "agent process exited", and what the agent last said before it did.
fn exit_reason(tail: &StderrTail) -> String {
    let tail = locked(tail);
    if tail.is_empty() {
        "agent process exited".to_string()
    } else {
        let said: Vec<&str> = tail.iter().map(String::as_str).collect();
        format!("agent process exited: {}", said.join(" | "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_exit_says_what_the_agent_last_printed() {
        let tail = StderrTail::default();
        assert_eq!(exit_reason(&tail), "agent process exited");

        remember_stderr(&tail, "npm error EACCES");
        remember_stderr(&tail, "   ");
        remember_stderr(&tail, "cannot write the cache");
        assert_eq!(
            exit_reason(&tail),
            "agent process exited: npm error EACCES | cannot write the cache"
        );
    }

    #[test]
    fn only_the_last_few_short_lines_are_kept() {
        let tail = StderrTail::default();
        for n in 0..10 {
            remember_stderr(&tail, &format!("line {n}"));
        }
        remember_stderr(&tail, &"x".repeat(1000));

        let kept = locked(&tail);
        assert_eq!(kept.len(), STDERR_TAIL_LINES);
        assert_eq!(kept.front().map(String::as_str), Some("line 5"));
        assert_eq!(kept.back().map(String::len), Some(STDERR_LINE_CHARS));
    }

    #[test]
    fn an_internal_error_keeps_the_reason_under_it() {
        let error = json!({ "code": -32603, "message": "Internal error", "data": { "details": "Invalid Mode" } });
        assert_eq!(error_text(&error), "Internal error: Invalid Mode");

        let plain =
            json!({ "code": -32602, "message": "Invalid params: mode not found: read-only" });
        assert_eq!(
            error_text(&plain),
            "Invalid params: mode not found: read-only"
        );

        let bare = json!({ "code": 1 });
        assert_eq!(error_text(&bare), r#"{"code":1}"#);
    }

    struct AllowAll;
    impl Gate for AllowAll {
        fn allows(&self, _: &Value) -> bool {
            true
        }
    }

    fn asking() -> Value {
        json!({ "toolCall": { "toolCallId": "c1" }, "options": [
            { "optionId": "always", "kind": "allow_always" },
            { "optionId": "once", "kind": "allow_once" },
            { "optionId": "no", "kind": "reject_once" },
        ]})
    }

    #[test]
    fn every_permission_is_refused_and_the_id_comes_back_as_it_was_sent() {
        // Real agents number their own requests from 0, and some use strings.
        for id in [json!(0), json!("agent-7")] {
            let (reply, allowed) = reply_to_agent(
                "session/request_permission",
                id.clone(),
                &asking(),
                &RefuseAll,
            );
            assert_eq!(reply["id"], id);
            assert_eq!(reply["result"]["outcome"]["outcome"], "cancelled");
            assert!(!allowed);
        }
    }

    #[test]
    fn an_allowed_permission_is_allowed_once_and_never_always() {
        let (reply, allowed) =
            reply_to_agent("session/request_permission", json!(1), &asking(), &AllowAll);
        assert!(allowed);
        assert_eq!(
            reply["result"]["outcome"],
            json!({ "outcome": "selected", "optionId": "once" })
        );

        // With no way to allow it just once, it is not allowed at all.
        let only_always = json!({ "options": [{ "optionId": "always", "kind": "allow_always" }] });
        let (reply, allowed) = reply_to_agent(
            "session/request_permission",
            json!(1),
            &only_always,
            &AllowAll,
        );
        assert!(!allowed);
        assert_eq!(reply["result"]["outcome"]["outcome"], "cancelled");
    }

    #[test]
    fn anything_else_the_agent_asks_for_is_not_a_method_nuza_has() {
        for method in ["fs/read_text_file", "fs/write_text_file", "terminal/create"] {
            // Not even a gate that allows everything opens these.
            let (reply, allowed) = reply_to_agent(method, json!(3), &json!({}), &AllowAll);
            assert_eq!(reply["error"]["code"], METHOD_NOT_FOUND);
            assert!(reply.get("result").is_none());
            assert!(!allowed);
        }
    }
}
