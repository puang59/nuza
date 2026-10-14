//! `AgentHarness`: the one agent process, and a conversation with it per
//! window.
//!
//! One process for the whole app, because starting an adapter through `npx`
//! takes seconds and ACP sessions cost nothing. One session per window,
//! because each window has its own vault and its own transcript, its own turn
//! in flight and its own Stop.
//!
//! Every way a turn can go wrong ends in a defined way: the agent dying (its
//! requests fail with its last words, and the next question starts it again),
//! the agent going quiet (given up on after three minutes of silence, however
//! long it has been talking before), a model the person's plan does not cover
//! (another one tried, at most four times), a window closing mid-answer (the
//! turn is cancelled and the session let go).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tokio::process::Command;
use tokio::sync::{mpsc, Mutex as AsyncMutex};

use super::config::AgentConfig;
use super::errors::{classify, AgentError};
use super::events::{self, AgentEvent, TURN_FAILED, TURN_FINISHED, TURN_NOTICE};
use super::rpc::{Gate, Inbound, InboundSender, RpcClient};
use crate::state::locked;

/// A turn that says nothing at all - no words, no thoughts, no steps - for
/// this long is given up on. Generous, because a model can think for a long
/// time before its first word; the point is only that a dead agent cannot
/// hold a panel open forever.
const TURN_IDLE_TIMEOUT: Duration = Duration::from_secs(180);
/// How often a turn is checked against that.
const IDLE_CHECK: Duration = Duration::from_millis(250);
/// How long an agent gets to answer `initialize`. A first start through
/// `npx` fetches the adapter and has been seen to take over a minute and a
/// half.
const START_PATIENCE: Duration = Duration::from_secs(300);
/// How many models one question may be moved through before the person is
/// told their plan turned it down.
const MAX_MODEL_SWITCHES: usize = 4;
/// Words are held back and sent on together, at most this often and no more
/// than this much at a time: a fast model sends tokens faster than the panel
/// should draw them.
const COALESCE_EVERY: Duration = Duration::from_millis(50);
const COALESCE_BYTES: usize = 256;

/// Modes in which an agent asks before it changes anything, best first.
/// `plan` is not one: in it, Claude Code wrote a file without asking.
const ASKS_FIRST: [&str; 4] = ["read-only", "default", "ask", "manual"];

/// How an agent is started, given its config. Real ones go through
/// `start::command_for`; the tests start the mock.
pub(crate) type Launcher = Arc<dyn Fn(&AgentConfig) -> Result<Command, String> + Send + Sync>;
/// Where a turn's events go: a window's IPC channel, or a test's list.
pub(crate) type Emit = Arc<dyn Fn(AgentEvent) + Send + Sync>;

/// A model the person's plan offers, for the picker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct ModelInfo {
    /// What the agent takes to select it: `gpt-5.5[low]`, `sonnet`.
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) description: String,
}

pub(crate) struct AgentHarness {
    /// Which agent to start; `None` when AI is off.
    config: Mutex<Option<AgentConfig>>,
    launcher: Launcher,
    connection: AsyncMutex<Option<Connection>>,
    /// Counts processes started, so a session can tell it belongs to one that
    /// has since died.
    started: AtomicU64,
    /// Each window's session, by window label.
    sessions: AsyncMutex<HashMap<String, Session>>,
    /// The turns in flight, by session id: where their events go, and when
    /// the agent last said anything in them.
    turns: Arc<Mutex<HashMap<String, Turn>>>,
    models: Mutex<ModelState>,
    policy: Arc<Policy>,
    /// Where every session's empty working directory is made.
    sessions_root: PathBuf,
    idle_timeout: Duration,
    coalesce: (Duration, usize),
}

#[derive(Clone)]
struct Connection {
    client: Arc<RpcClient>,
    /// Into the same queue the agent's own messages are read into, for the
    /// harness's word on a turn.
    inbound: InboundSender,
    process: u64,
    /// The agent can pick a session up again after it restarted.
    can_resume: bool,
}

struct Session {
    id: String,
    vault: Option<PathBuf>,
    process: u64,
    model: Option<String>,
    /// Removed when the session is let go.
    _cwd: tempfile::TempDir,
}

struct Turn {
    window: String,
    sink: mpsc::UnboundedSender<AgentEvent>,
    heard: Instant,
}

#[derive(Default)]
struct ModelState {
    /// What the plan offers, from the latest session, in the agent's order.
    available: Vec<ModelInfo>,
    /// Model names the plan has turned a prompt down on, never picked again
    /// while the agent runs.
    rejected: HashSet<String>,
}

/// Which of the agent's permission requests are allowed. Everything is
/// refused, except fetching a web page in a session on a vault whose owner
/// turned web lookups on.
#[derive(Default)]
pub(crate) struct Policy {
    web_vaults: Mutex<HashSet<PathBuf>>,
    session_vaults: Mutex<HashMap<String, PathBuf>>,
}

impl Gate for Policy {
    fn allows(&self, request: &Value) -> bool {
        let is_fetch = request.pointer("/toolCall/kind").and_then(Value::as_str) == Some("fetch");
        let Some(session) = request.get("sessionId").and_then(Value::as_str) else {
            return false;
        };
        let vault = locked(&self.session_vaults).get(session).cloned();
        is_fetch && vault.is_some_and(|vault| locked(&self.web_vaults).contains(&vault))
    }
}

impl AgentHarness {
    pub(crate) fn new(launcher: Launcher, sessions_root: PathBuf) -> Self {
        Self {
            config: Mutex::new(None),
            launcher,
            connection: AsyncMutex::new(None),
            started: AtomicU64::new(0),
            sessions: AsyncMutex::default(),
            turns: Arc::default(),
            models: Mutex::default(),
            policy: Arc::default(),
            sessions_root,
            idle_timeout: TURN_IDLE_TIMEOUT,
            coalesce: (COALESCE_EVERY, COALESCE_BYTES),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_idle_timeout(mut self, timeout: Duration) -> Self {
        self.idle_timeout = timeout;
        self
    }

    #[cfg(test)]
    pub(crate) fn with_coalescing(mut self, every: Duration, bytes: usize) -> Self {
        self.coalesce = (every, bytes);
        self
    }

    /// Takes up the agent that was turned on when the app last ran, without
    /// starting it: nothing is started until it is needed.
    pub(crate) fn restore(&self, config: Option<AgentConfig>) {
        *locked(&self.config) = config;
    }

    /// The agent that is turned on, if one is.
    pub(crate) fn current(&self) -> Option<AgentConfig> {
        locked(&self.config).clone()
    }

    /// Turns the agent off, or switches to another: the running one is
    /// stopped, its sessions forgotten, and nothing it knew about models is
    /// kept - a model id means nothing to a different agent.
    pub(crate) async fn set_agent(&self, config: Option<AgentConfig>) {
        *locked(&self.config) = config;
        self.shutdown().await;
        *locked(&self.models) = ModelState::default();
    }

    /// Switches to `config` and starts it now, so a wrong command or a
    /// program that does not speak ACP fails in Settings rather than at the
    /// first question.
    pub(crate) async fn use_agent(&self, config: AgentConfig) -> Result<(), AgentError> {
        self.set_agent(Some(config)).await;
        self.warm().await
    }

    /// Starts the agent ahead of the first question, if one is turned on.
    pub(crate) async fn warm(&self) -> Result<(), AgentError> {
        let config = self.current().ok_or_else(AgentError::off)?;
        let started = Instant::now();
        self.connection()
            .await
            .map_err(|raw| classify(&raw, &config))?;
        log::info!(
            "{} ready after {} ms",
            config.label(),
            started.elapsed().as_millis()
        );
        Ok(())
    }

    /// Lets the agent fetch web pages in sessions on `vault`, or stops it.
    pub(crate) fn set_web_lookups(&self, vault: &Path, allowed: bool) {
        let mut vaults = locked(&self.policy.web_vaults);
        if allowed {
            vaults.insert(vault.to_path_buf());
        } else {
            vaults.remove(vault);
        }
    }

    /// Stops the agent, and forgets every session.
    pub(crate) async fn shutdown(&self) {
        if let Some(connection) = self.connection.lock().await.take() {
            connection.client.kill().await;
        }
        self.sessions.lock().await.clear();
        locked(&self.policy.session_vaults).clear();
    }

    /// Stops the agent without waiting, for the app on its way out. Dropping
    /// the client kills the agent and everything it started.
    pub(crate) fn shutdown_now(&self) {
        if let Ok(mut connection) = self.connection.try_lock() {
            if let Some(connection) = connection.take() {
                connection.client.kill_now();
            }
        }
    }

    /// Whether the agent is running.
    #[cfg(test)]
    pub(crate) async fn running(&self) -> bool {
        match self.connection.lock().await.as_ref() {
            Some(connection) => !connection.client.has_exited().await,
            None => false,
        }
    }

    /// Asks the question `text` in `window`'s conversation, about `vault`,
    /// on `model` if one is given. What the agent says goes to `emit` as it
    /// arrives, ending with `Done` or `Failed`; the same outcome is returned.
    pub(crate) async fn prompt(
        &self,
        window: &str,
        vault: Option<&Path>,
        text: &str,
        model: Option<&str>,
        emit: Emit,
    ) -> Result<String, AgentError> {
        let config = self.current().ok_or_else(AgentError::off)?;
        if locked(&self.turns)
            .values()
            .any(|turn| turn.window == window)
        {
            return Err(AgentError::other(
                "This window is already waiting on an answer. Stop it first.",
            ));
        }

        let (sink, receiver) = mpsc::unbounded_channel();
        let delivered = tokio::spawn(coalesce(receiver, Arc::clone(&emit), self.coalesce));
        let outcome = self
            .run_turn(&config, window, vault, text, model, &sink)
            .await;
        // The coalescer stops at the turn's last event, once it has passed
        // everything before it on.
        eprintln!("DBG run_turn returned ok={}", outcome.is_ok());
        let _ = delivered.await;
        eprintln!("DBG delivered");
        if let Ok((session, _)) | Err((Some(session), _)) = &outcome {
            locked(&self.turns).remove(session);
        }
        match outcome {
            Ok((_, stop)) => Ok(stop),
            Err((_, error)) => Err(error),
        }
    }

    /// The turn itself. Returns the session it ran in, when it got that far,
    /// so the caller can let the turn go.
    #[allow(clippy::type_complexity)]
    async fn run_turn(
        &self,
        config: &AgentConfig,
        window: &str,
        vault: Option<&Path>,
        text: &str,
        model: Option<&str>,
        sink: &mpsc::UnboundedSender<AgentEvent>,
    ) -> Result<(String, String), (Option<String>, AgentError)> {
        // Before there is a session there is nothing in flight that a
        // failure could overtake, so it is said straight away.
        let fail_now = |raw: String| {
            let error = classify(&raw, config);
            let _ = sink.send(AgentEvent::Failed {
                code: error.kind,
                message: error.message.clone(),
            });
            (None, error)
        };
        let connection = self.connection().await.map_err(fail_now)?;
        let session = self
            .session_for(&connection, config, window, vault, sink)
            .await
            .map_err(fail_now)?;

        locked(&self.turns).insert(
            session.clone(),
            Turn {
                window: window.to_string(),
                sink: sink.clone(),
                heard: Instant::now(),
            },
        );

        let asked = match model {
            Some(model) => self.use_model(&connection, config, window, model).await,
            None => Ok(()),
        };
        let answered = match asked {
            Ok(()) => self.ask(&connection, config, &session, text).await,
            Err(error) => Err(error),
        };

        // The turn's last word goes in behind the agent's, through the same
        // queue, so it cannot arrive before the agent's last word does.
        let (method, params, result) = match answered {
            Ok(stop) => (
                TURN_FINISHED,
                json!({ "sessionId": session, "stopReason": stop }),
                Ok(stop),
            ),
            Err(raw) => {
                let error = classify(&raw, config);
                log::warn!("{} could not answer: {raw}", config.label());
                (
                    TURN_FAILED,
                    json!({ "sessionId": session, "code": error.kind, "message": error.message }),
                    Err(error),
                )
            }
        };
        let last = Inbound {
            method: method.to_string(),
            params,
        };
        if connection.inbound.send(last.clone()).is_err() {
            if let Some(event) = events::event_of(&last) {
                let _ = sink.send(event);
            }
        }
        match result {
            Ok(stop) => Ok((session, stop)),
            Err(error) => Err((Some(session), error)),
        }
    }

    /// Asks the agent to stop the turn in `window`'s conversation. The turn
    /// then ends as usual, with what was said so far and a `Done`.
    pub(crate) async fn cancel(&self, window: &str) -> Result<(), String> {
        let session = locked(&self.turns)
            .iter()
            .find(|(_, turn)| turn.window == window)
            .map(|(session, _)| session.clone());
        let Some(session) = session else {
            return Ok(());
        };
        let connection = self.connection.lock().await.clone();
        match connection {
            Some(connection) => {
                connection
                    .client
                    .notify("session/cancel", json!({ "sessionId": session }))
                    .await
            }
            None => Ok(()),
        }
    }

    /// Starts the next question in `window` as a new conversation.
    pub(crate) async fn new_chat(&self, window: &str) {
        if let Some(session) = self.sessions.lock().await.remove(window) {
            locked(&self.policy.session_vaults).remove(&session.id);
        }
    }

    /// A window has closed: its turn is stopped and its session let go.
    pub(crate) async fn forget_window(&self, window: &str) {
        let _ = self.cancel(window).await;
        self.new_chat(window).await;
    }

    /// The models the person's plan offers, for the picker. They are only
    /// reported when a session starts, so with none known yet a session is
    /// opened to learn them.
    pub(crate) async fn list_models(&self) -> Result<Vec<ModelInfo>, AgentError> {
        let config = self.current().ok_or_else(AgentError::off)?;
        if locked(&self.models).available.is_empty() {
            let connection = self
                .connection()
                .await
                .map_err(|raw| classify(&raw, &config))?;
            let cwd = self.fresh_cwd().map_err(|raw| classify(&raw, &config))?;
            let opened = connection
                .client
                .request(
                    "session/new",
                    json!({ "cwd": cwd.path(), "mcpServers": [] }),
                )
                .await
                .map_err(|raw| classify(&raw, &config))?;
            self.record_models(&opened);
        }
        Ok(self.usable_models())
    }

    /// The running agent, started if it is not.
    async fn connection(&self) -> Result<Connection, String> {
        let mut slot = self.connection.lock().await;
        if let Some(connection) = slot.as_ref() {
            if !connection.client.has_exited().await {
                return Ok(connection.clone());
            }
            log::warn!("the agent had stopped; starting it again");
        }
        *slot = None;

        let config = self
            .current()
            .ok_or_else(|| "no agent is turned on".to_string())?;
        let launcher = Arc::clone(&self.launcher);
        let for_launcher = config.clone();
        // Building the command can ask the login shell for its PATH, which
        // blocks.
        let command = tokio::task::spawn_blocking(move || launcher(&for_launcher))
            .await
            .map_err(|error| error.to_string())??;

        let (inbound, queue) = mpsc::unbounded_channel();
        let gate: Arc<dyn Gate> = Arc::clone(&self.policy) as Arc<dyn Gate>;
        let client = RpcClient::spawn(command, inbound.clone(), gate)
            .map_err(|error| format!("could not start {}: {error}", config.label()))?;
        route(queue, Arc::clone(&self.turns));

        // No `fs`, no `terminal`: there is no way, in the protocol, for the
        // agent to ask nuza to read a file, write one or run a command.
        let hello = tokio::time::timeout(
            START_PATIENCE,
            client.request(
                "initialize",
                json!({ "protocolVersion": 1, "clientCapabilities": {} }),
            ),
        )
        .await
        .map_err(|_| {
            format!(
                "could not start {}: it did not answer for {} seconds",
                config.label(),
                START_PATIENCE.as_secs()
            )
        })
        .and_then(|answer| answer);
        let hello = match hello {
            Ok(hello) => hello,
            Err(error) => {
                client.kill().await;
                return Err(error);
            }
        };

        let connection = Connection {
            client: Arc::new(client),
            inbound,
            process: self.started.fetch_add(1, Ordering::Relaxed) + 1,
            can_resume: hello
                .pointer("/agentCapabilities/sessionCapabilities/resume")
                .is_some(),
        };
        *slot = Some(connection.clone());
        Ok(connection)
    }

    /// The session `window` talks in, made (or picked up again) if it has
    /// none in the running agent.
    async fn session_for(
        &self,
        connection: &Connection,
        config: &AgentConfig,
        window: &str,
        vault: Option<&Path>,
        sink: &mpsc::UnboundedSender<AgentEvent>,
    ) -> Result<String, String> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get(window) {
            if session.process == connection.process && session.vault.as_deref() == vault {
                return Ok(session.id.clone());
            }
        }
        let previous = sessions.remove(window);
        if let Some(previous) = &previous {
            locked(&self.policy.session_vaults).remove(&previous.id);
        }

        // Never the vault, and never anywhere anything of the person's lives:
        // an agent in a "read-only" session may still write in its own
        // working directory.
        let cwd = self.fresh_cwd()?;
        let servers = json!([]);

        // A conversation the agent was in before it restarted is picked up
        // again where the agent can do that; otherwise the person is told.
        let mut resumed = None;
        if let Some(previous) = previous.as_ref().filter(|previous| {
            connection.can_resume
                && previous.vault.as_deref() == vault
                && previous.process != connection.process
        }) {
            match connection
                .client
                .request(
                    "session/resume",
                    json!({ "sessionId": previous.id, "cwd": cwd.path(), "mcpServers": servers }),
                )
                .await
            {
                Ok(answer) => resumed = Some((previous.id.clone(), answer)),
                Err(error) => log::warn!("could not pick the conversation up again: {error}"),
            }
        }
        let (id, answer) = match resumed {
            Some(resumed) => resumed,
            None => {
                let answer = connection
                    .client
                    .request(
                        "session/new",
                        json!({ "cwd": cwd.path(), "mcpServers": servers }),
                    )
                    .await?;
                let id = answer
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .ok_or("the agent did not say what its session is called")?
                    .to_string();
                if previous.is_some() {
                    let _ = sink.send(AgentEvent::Notice {
                        text: format!(
                            "{} started a fresh conversation, so it won't remember what was said before.",
                            config.label()
                        ),
                    });
                }
                (id, answer)
            }
        };

        lock_down(&connection.client, config, &id, &answer).await?;
        self.record_models(&answer);
        let model = self
            .move_off_unoffered(connection, config, &id, &answer)
            .await;

        if let Some(vault) = vault {
            locked(&self.policy.session_vaults).insert(id.clone(), vault.to_path_buf());
        }
        sessions.insert(
            window.to_string(),
            Session {
                id: id.clone(),
                vault: vault.map(Path::to_path_buf),
                process: connection.process,
                model,
                _cwd: cwd,
            },
        );
        Ok(id)
    }

    fn fresh_cwd(&self) -> Result<tempfile::TempDir, String> {
        std::fs::create_dir_all(&self.sessions_root)
            .and_then(|()| {
                tempfile::Builder::new()
                    .prefix("session-")
                    .tempdir_in(&self.sessions_root)
            })
            .map_err(|error| format!("could not make a folder for the conversation: {error}"))
    }

    /// Sends the prompt and waits for the turn to end, moving to another
    /// model when the person's plan turns the question down for its model.
    async fn ask(
        &self,
        connection: &Connection,
        config: &AgentConfig,
        session: &str,
        text: &str,
    ) -> Result<String, String> {
        let params = json!({ "sessionId": session, "prompt": [{ "type": "text", "text": text }] });
        let mut tried = HashSet::new();
        loop {
            match self.answer(connection, session, params.clone()).await {
                Ok(answer) => {
                    return Ok(answer
                        .get("stopReason")
                        .and_then(Value::as_str)
                        .unwrap_or("end_turn")
                        .to_string())
                }
                Err(error) if is_model_refused(&error) && tried.len() < MAX_MODEL_SWITCHES => {
                    let Some(next) = self.next_model(&error, &mut tried) else {
                        return Err(error);
                    };
                    if set_model(&connection.client, config, session, &next.id)
                        .await
                        .is_err()
                    {
                        return Err(error);
                    }
                    let _ = connection.inbound.send(Inbound {
                        method: TURN_NOTICE.to_string(),
                        params: json!({
                            "sessionId": session,
                            "text": format!("Your plan can't use that model, so {} is answering on {} instead.", config.label(), next.name),
                        }),
                    });
                }
                Err(error) => return Err(error),
            }
        }
    }

    /// One `session/prompt`, given up on if the agent goes quiet for longer
    /// than the idle timeout - anything it says in the session counts as not
    /// quiet, so a slow answer that keeps talking is never cut off.
    async fn answer(
        &self,
        connection: &Connection,
        session: &str,
        params: Value,
    ) -> Result<Value, String> {
        self.heard_from(session);
        let request = connection.client.request("session/prompt", params);
        tokio::pin!(request);
        loop {
            tokio::select! {
                answer = &mut request => return answer,
                () = tokio::time::sleep(IDLE_CHECK) => {
                    eprintln!("DBG tick quiet={:?}", self.quiet_for(session));
                    if self.quiet_for(session) > self.idle_timeout {
                        eprintln!("DBG timing out");
                        let _ = connection
                            .client
                            .notify("session/cancel", json!({ "sessionId": session }))
                            .await;
                        eprintln!("DBG cancel sent");
                        return Err(format!(
                            "The agent stopped responding (nothing for {} seconds).",
                            self.idle_timeout.as_secs()
                        ));
                    }
                }
            }
        }
    }

    fn heard_from(&self, session: &str) {
        if let Some(turn) = locked(&self.turns).get_mut(session) {
            turn.heard = Instant::now();
        }
    }

    fn quiet_for(&self, session: &str) -> Duration {
        locked(&self.turns)
            .get(session)
            .map_or(Duration::ZERO, |turn| turn.heard.elapsed())
    }

    /// Puts `window`'s session on `model`, if it is not on it already.
    async fn use_model(
        &self,
        connection: &Connection,
        config: &AgentConfig,
        window: &str,
        model: &str,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        let Some(session) = sessions.get_mut(window) else {
            return Ok(());
        };
        if session.model.as_deref() == Some(model) {
            return Ok(());
        }
        set_model(&connection.client, config, &session.id, model).await?;
        session.model = Some(model.to_string());
        Ok(())
    }

    fn record_models(&self, session: &Value) {
        let offered = models_in(session);
        if !offered.is_empty() {
            locked(&self.models).available = offered;
        }
    }

    fn usable_models(&self) -> Vec<ModelInfo> {
        let models = locked(&self.models);
        models
            .available
            .iter()
            .filter(|model| !models.rejected.contains(model_name(&model.id)))
            .cloned()
            .collect()
    }

    /// An agent's own config can name a model the person's plan cannot use,
    /// and every question then fails. When a new session starts on a model
    /// its plan does not offer, it is moved to one that is. Returns the model
    /// the session is on.
    async fn move_off_unoffered(
        &self,
        connection: &Connection,
        config: &AgentConfig,
        session: &str,
        answer: &Value,
    ) -> Option<String> {
        let current = current_model(answer);
        let usable: Vec<String> = self.usable_models().into_iter().map(|m| m.id).collect();
        let usable: Vec<&str> = usable.iter().map(String::as_str).collect();
        let Some(pick) = pick_model(current.as_deref(), &usable) else {
            return current;
        };
        log::warn!("{current:?} is not offered on this plan; using {pick}");
        match set_model(&connection.client, config, session, &pick).await {
            Ok(()) => Some(pick),
            Err(_) => current,
        }
    }

    /// After the plan turned a question down for its model: that model is
    /// never picked again, and the next one offered is. `tried` keeps one
    /// question from going round in circles.
    fn next_model(&self, error: &str, tried: &mut HashSet<String>) -> Option<ModelInfo> {
        if let Some(name) = refused_model(error) {
            locked(&self.models).rejected.insert(name.clone());
            tried.insert(name);
        }
        let next = self
            .usable_models()
            .into_iter()
            .find(|model| !tried.contains(model_name(&model.id)))?;
        tried.insert(model_name(&next.id).to_string());
        Some(next)
    }
}

/// Delivers the running agent's messages to the turn each is about.
fn route(mut queue: mpsc::UnboundedReceiver<Inbound>, turns: Arc<Mutex<HashMap<String, Turn>>>) {
    tokio::spawn(async move {
        while let Some(message) = queue.recv().await {
            eprintln!("DBG route {}", message.method);
            let Some(session) = events::session_of(&message) else {
                continue;
            };
            let mut turns = locked(&turns);
            let Some(turn) = turns.get_mut(session) else {
                continue;
            };
            // Anything at all from the session shows the agent is alive.
            turn.heard = Instant::now();
            if let Some(event) = events::event_of(&message) {
                let _ = turn.sink.send(event);
            }
        }
    });
}

/// Passes a turn's events on, with runs of words (and of thoughts) joined up
/// and sent at most every `every` or `bytes`. Anything else goes straight
/// through, after the words before it. Stops after the turn's last event.
async fn coalesce(
    mut events: mpsc::UnboundedReceiver<AgentEvent>,
    emit: Emit,
    (every, bytes): (Duration, usize),
) {
    let mut held: Option<AgentEvent> = None;
    let mut deadline = tokio::time::Instant::now();
    let flush = |held: &mut Option<AgentEvent>| {
        if let Some(event) = held.take() {
            emit(event);
        }
    };
    loop {
        let event = if held.is_some() {
            tokio::select! {
                event = events.recv() => event,
                () = tokio::time::sleep_until(deadline) => {
                    flush(&mut held);
                    continue;
                }
            }
        } else {
            events.recv().await
        };
        let Some(event) = event else {
            flush(&mut held);
            return;
        };
        match (&mut held, event) {
            (Some(AgentEvent::Token { text: so_far }), AgentEvent::Token { text })
            | (Some(AgentEvent::Thought { text: so_far }), AgentEvent::Thought { text }) => {
                so_far.push_str(&text);
            }
            (_, event @ (AgentEvent::Token { .. } | AgentEvent::Thought { .. })) => {
                flush(&mut held);
                held = Some(event);
                deadline = tokio::time::Instant::now() + every;
            }
            (_, event) => {
                flush(&mut held);
                let last = matches!(event, AgentEvent::Done { .. } | AgentEvent::Failed { .. });
                emit(event);
                if last {
                    return;
                }
            }
        }
        if let Some(AgentEvent::Token { text } | AgentEvent::Thought { text }) = &held {
            if text.len() >= bytes {
                flush(&mut held);
            }
        }
    }
}

/// Puts a new session somewhere it asks before it changes anything.
///
/// `read-only` where the agent has it. Otherwise a mode that asks first, so
/// every change reaches nuza as a permission request, which nuza refuses.
/// An agent with modes, none of which asks, is not used at all. An agent
/// with no modes is asked for `read-only` in case, and the sandbox is what
/// holds.
async fn lock_down(
    client: &RpcClient,
    config: &AgentConfig,
    session: &str,
    answer: &Value,
) -> Result<(), String> {
    let modes = answer.get("modes");
    let available: Vec<&str> = modes
        .and_then(|modes| modes.get("availableModes"))
        .and_then(Value::as_array)
        .map(|modes| modes.iter().filter_map(|m| m.get("id")?.as_str()).collect())
        .unwrap_or_default();
    let current = modes
        .and_then(|modes| modes.get("currentModeId"))
        .and_then(Value::as_str);

    let target = if modes.is_none() {
        Some("read-only")
    } else {
        ASKS_FIRST
            .iter()
            .copied()
            .find(|mode| available.contains(mode))
            .filter(|mode| Some(*mode) != current)
    };
    let safe_already = current.is_some_and(|mode| ASKS_FIRST.contains(&mode));
    let name = config.label();

    if config.requires_read_only() && current != Some("read-only") && target != Some("read-only") {
        return Err(format!(
            "{name} has no read-only mode, so nuza won't use it"
        ));
    }
    let Some(target) = target else {
        return if safe_already || modes.is_none() {
            Ok(())
        } else {
            Err(format!(
                "{name} has no mode that asks before it changes something, so nuza won't use it"
            ))
        };
    };
    let switched = client
        .request(
            "session/set_mode",
            json!({ "sessionId": session, "modeId": target }),
        )
        .await;
    match switched {
        Ok(_) => Ok(()),
        Err(error) if modes.is_none() => {
            log::info!("{name} has no read-only mode ({error}); the sandbox is what holds");
            Ok(())
        }
        Err(error) if safe_already && !config.requires_read_only() => {
            log::warn!("{name} stays in {current:?}: {error}");
            Ok(())
        }
        Err(error) => Err(format!("could not make the session read-only: {error}")),
    }
}

async fn set_model(
    client: &RpcClient,
    config: &AgentConfig,
    session: &str,
    model: &str,
) -> Result<(), String> {
    let (method, params) = if config.sets_model_directly() {
        (
            "session/set_model",
            json!({ "sessionId": session, "modelId": model }),
        )
    } else {
        (
            "session/set_config_option",
            json!({ "sessionId": session, "configId": "model", "value": model }),
        )
    };
    client.request(method, params).await.map(|_| ())
}

/// The models a session's answer offers, in the agent's order: under
/// `models.availableModels` (Codex), or as the `model` entry in
/// `configOptions` (Claude Code, OpenCode).
pub(crate) fn models_in(session: &Value) -> Vec<ModelInfo> {
    let text = |model: &Value, key: &str| {
        model
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let named = |id: &str, model: &Value| {
        let name = text(model, "name");
        ModelInfo {
            id: id.to_string(),
            name: if name.is_empty() {
                id.to_string()
            } else {
                name
            },
            description: text(model, "description"),
        }
    };
    if let Some(list) = session
        .pointer("/models/availableModels")
        .and_then(Value::as_array)
    {
        return list
            .iter()
            .filter_map(|model| Some(named(model.get("modelId")?.as_str()?, model)))
            .collect();
    }
    model_option(session)
        .and_then(|option| option.get("options").and_then(Value::as_array))
        .map(|list| {
            list.iter()
                .filter_map(|model| Some(named(model.get("value")?.as_str()?, model)))
                .collect()
        })
        .unwrap_or_default()
}

fn model_option(session: &Value) -> Option<&Value> {
    session
        .get("configOptions")?
        .as_array()?
        .iter()
        .find(|option| {
            option.get("category").and_then(Value::as_str) == Some("model")
                || option.get("id").and_then(Value::as_str) == Some("model")
        })
}

/// The model a session started on.
fn current_model(session: &Value) -> Option<String> {
    session
        .pointer("/models/currentModelId")
        .or_else(|| model_option(session)?.get("currentValue"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// `gpt-5.5` of `gpt-5.5[low]`: the model without its reasoning effort.
fn model_name(id: &str) -> &str {
    id.split('[').next().unwrap_or(id)
}

/// Whether an error is the plan turning a model down.
fn is_model_refused(error: &str) -> bool {
    let error = error.to_lowercase();
    error.contains("model") && (error.contains("not supported") || error.contains("not available"))
}

/// The model named in quotes in such an error: "The 'gpt-5.6-sol' model is
/// not supported when using Codex with a ChatGPT account."
fn refused_model(error: &str) -> Option<String> {
    let name = error.split('\'').nth(1)?.trim();
    (!name.is_empty() && name.len() < 64 && !name.contains(' ')).then(|| name.to_string())
}

/// The model to move to, or `None` when the current one is offered. A model
/// offered at any reasoning effort counts as offered; otherwise the first
/// one offered at the same effort, so a preference for speed survives.
fn pick_model(current: Option<&str>, offered: &[&str]) -> Option<String> {
    fn effort(id: &str) -> Option<&str> {
        id.split_once('[')?.1.strip_suffix(']')
    }
    let current = current?;
    if offered.is_empty() || offered.iter().any(|m| model_name(m) == model_name(current)) {
        return None;
    }
    offered
        .iter()
        .find(|m| effort(m) == effort(current))
        .or(offered.first())
        .map(|m| m.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn models_are_read_from_either_shape() {
        let codex = json!({ "models": { "currentModelId": "gpt-5.5[low]", "availableModels": [
            { "modelId": "gpt-5.5[low]", "name": "5.5 (low)", "description": "d" }
        ]}});
        let found = models_in(&codex);
        assert_eq!(
            (found[0].id.as_str(), found[0].name.as_str()),
            ("gpt-5.5[low]", "5.5 (low)")
        );
        assert_eq!(current_model(&codex).as_deref(), Some("gpt-5.5[low]"));

        // As Claude Code and OpenCode report them.
        let other = json!({ "configOptions": [
            { "id": "mode", "category": "mode", "options": [{ "value": "default" }] },
            { "id": "model", "category": "model", "currentValue": "opus", "options": [
                { "value": "opus", "name": "Opus 5.5" }, { "value": "haiku" }
            ]}
        ]});
        let found = models_in(&other);
        assert_eq!(
            found.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            ["opus", "haiku"]
        );
        // No name given, so the id stands in.
        assert_eq!(found[1].name, "haiku");
        assert_eq!(current_model(&other).as_deref(), Some("opus"));
        assert!(models_in(&json!({ "sessionId": "s" })).is_empty());
    }

    const OFFERED: [&str; 4] = ["luna[low]", "luna[high]", "gpt-5.5[low]", "gpt-5.5[high]"];

    #[test]
    fn a_model_the_plan_offers_is_kept_at_any_effort() {
        assert_eq!(pick_model(Some("gpt-5.5[high]"), &OFFERED), None);
        assert_eq!(pick_model(Some("luna[xhigh]"), &OFFERED), None);
        assert_eq!(pick_model(Some("opus"), &["opus", "sonnet"]), None);
    }

    #[test]
    fn a_model_the_plan_does_not_offer_is_swapped_at_the_same_effort() {
        assert_eq!(
            pick_model(Some("sol[high]"), &OFFERED).as_deref(),
            Some("luna[high]")
        );
        assert_eq!(
            pick_model(Some("sol[ultra]"), &OFFERED).as_deref(),
            Some("luna[low]")
        );
        assert_eq!(
            pick_model(Some("sol"), &OFFERED).as_deref(),
            Some("luna[low]")
        );
    }

    #[test]
    fn without_anything_to_go_on_the_model_is_left_alone() {
        assert_eq!(pick_model(None, &OFFERED), None);
        assert_eq!(pick_model(Some("sol[low]"), &[]), None);
    }

    #[test]
    fn the_refused_model_is_read_from_the_error() {
        let error = "Internal error: The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account.";
        assert!(is_model_refused(error));
        assert_eq!(refused_model(error).as_deref(), Some("gpt-5.6-sol"));
        assert!(!is_model_refused("You've hit your usage limit"));
    }

    #[test]
    fn the_web_is_allowed_only_for_a_vault_that_turned_it_on() {
        let policy = Policy::default();
        let fetch =
            |session: &str| json!({ "sessionId": session, "toolCall": { "kind": "fetch" } });
        locked(&policy.session_vaults).insert("a".into(), PathBuf::from("/notes/a"));
        locked(&policy.session_vaults).insert("b".into(), PathBuf::from("/notes/b"));
        assert!(!policy.allows(&fetch("a")));

        locked(&policy.web_vaults).insert(PathBuf::from("/notes/a"));
        assert!(policy.allows(&fetch("a")));
        assert!(!policy.allows(&fetch("b")));
        assert!(!policy.allows(&fetch("unknown")));
        // Still only a fetch: the same vault cannot run a command.
        assert!(!policy.allows(&json!({ "sessionId": "a", "toolCall": { "kind": "execute" } })));
    }

    async fn coalesced(events: Vec<AgentEvent>, bytes: usize) -> Vec<AgentEvent> {
        let (sender, receiver) = mpsc::unbounded_channel();
        let out = Arc::new(Mutex::new(Vec::new()));
        let kept = Arc::clone(&out);
        let emit: Emit = Arc::new(move |event| locked(&kept).push(event));
        for event in events {
            sender.send(event).unwrap();
        }
        coalesce(receiver, emit, (Duration::from_secs(5), bytes)).await;
        let out = locked(&out).clone();
        out
    }

    fn token(text: &str) -> AgentEvent {
        AgentEvent::Token { text: text.into() }
    }

    #[tokio::test]
    async fn words_are_joined_up_and_nothing_overtakes_them() {
        let out = coalesced(
            vec![
                AgentEvent::Thought { text: "a".into() },
                AgentEvent::Thought { text: "b".into() },
                token("Hel"),
                token("lo"),
                AgentEvent::Step {
                    id: "1".into(),
                    title: None,
                    status: None,
                },
                token(" there"),
                AgentEvent::Done {
                    stop_reason: "end_turn".into(),
                },
                token("after the end"),
            ],
            256,
        )
        .await;
        assert_eq!(
            out,
            [
                AgentEvent::Thought { text: "ab".into() },
                token("Hello"),
                AgentEvent::Step {
                    id: "1".into(),
                    title: None,
                    status: None
                },
                token(" there"),
                AgentEvent::Done {
                    stop_reason: "end_turn".into()
                },
            ]
        );
    }

    #[tokio::test]
    async fn a_long_run_of_words_is_sent_in_pieces() {
        let out = coalesced(
            vec![
                token("aaaa"),
                token("bbbb"),
                token("cc"),
                AgentEvent::Done {
                    stop_reason: "end_turn".into(),
                },
            ],
            8,
        )
        .await;
        assert_eq!(
            out,
            [
                token("aaaabbbb"),
                token("cc"),
                AgentEvent::Done {
                    stop_reason: "end_turn".into()
                }
            ]
        );
    }
}
