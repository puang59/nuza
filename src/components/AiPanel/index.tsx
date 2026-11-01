import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { History, SquarePen, X } from "lucide-react";
import { cn } from "cn";
import { useAgent } from "@/hooks/useAgent";
import { useAiChat, type ChatTurn, type Selected } from "@/hooks/useAiChat";
import { buildContext, fileName, selectionLines, type AiContext } from "@/lib/ai/context";
import { agentKey, chooseModel, modelToUse, type ModelChoices } from "@/lib/ai/modelChoice";
import type { ContextExtra, Intent } from "@/lib/ai/prompt";
import type { ModelInfo } from "@/lib/ai/protocol";
import { contextUsed } from "@/lib/ai/transcript";
import { matchesBinding } from "@/lib/keybinding";
import { EditorView } from "@codemirror/view";
import {
  acceptAllProposals,
  acceptProposal,
  focusProposal,
  pendingEdits,
  rejectAllProposals,
  rejectProposal,
} from "@/lib/markdown/aiDiff";
import type { EditCard } from "@/hooks/useAiChat";
import ContextChips, { type ContextChip } from "./ContextChips";
import ContextFiles from "./ContextFiles";
import PanelSwitcher, { type PanelView } from "./PanelSwitcher";
import { relativePath } from "@/lib/media";
import SetupChecklist from "./SetupChecklist";
import { CitationContext, type Citations } from "./citations";
import { invoke } from "@tauri-apps/api/core";
import { report } from "@/lib/notices";
import TurnView, { type TurnActions } from "./TurnView";
import ThreadList from "./ThreadList";
import Composer, { type ComposerHandle } from "./Composer";
import { canRun, parseCommand, requestFor, wordAt, type WritingAction } from "@/lib/ai/actions";

/** The note a question is about, as the editor has it right now. */
export interface NoteSnapshot {
  path: string;
  text: string;
  selection: { from: number; to: number };
}

export interface AiPanelHandle {
  /** Puts the keyboard in the composer, asking (or asking for a change). */
  focusComposer: (intent: Intent) => void;
}

interface AiPanelProps {
  isOpen: boolean;
  width: number;
  isResizing: boolean;
  onResizeStart: (event: React.PointerEvent) => void;
  onResizeReset: () => void;
  /** Reads the note being asked about. Null when there is no note to ask about. */
  readNote: () => NoteSnapshot | null;
  /** The editor showing the note at `path`, if one is - where its edits are drawn and applied. */
  viewFor: (path: string) => EditorView | null;
  /** Brings the note at `path` into the editor. */
  openNote: (path: string) => Promise<void>;
  /** Brings the note at `path` into the editor at `line`. */
  openAt: (path: string, line: number) => void;
  sendWholeNote: boolean;
  vaultPath: string | null;
  modelChoices: ModelChoices;
  setModelChoices: (choices: ModelChoices) => void;
  onClose: () => void;
  onReturnFocus: () => void;
  onOpenSettings: () => void;
  /** How the writer likes replies, in their own words. */
  instructions: string;
  /** What the writer asked the AI to keep in mind in this vault. */
  memory: string[];
  onRemember: (item: string) => void;
  /** Every note in the open vault, for picking the ones that go as context. */
  notes: readonly string[];
}

/** Lines of a note pinned to the context with mod+L, kept as they were then. */
interface PinnedLines {
  id: string;
  path: string;
  title: string;
  first: number;
  last: number;
  text: string;
}

/** The most of any one added note that goes, and of all of them together. */
const EXTRA_LIMIT = 12_000;
const EXTRAS_LIMIT = 40_000;

/** Where lines `first` to `last` (1-based) start and end in `text`. */
function offsetsOfLines(text: string, first: number, last: number) {
  const lines = text.split("\n");
  const start = lines.slice(0, Math.max(0, first - 1)).reduce((sum, line) => sum + line.length + 1, 0);
  const through = lines
    .slice(0, Math.min(lines.length, last))
    .reduce((sum, line) => sum + line.length + 1, 0);
  return { from: Math.min(start, text.length), to: Math.min(Math.max(start, through - 1), text.length) };
}

function clip(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit)}\n[… the rest left out …]` : text;
}

/**
 * Keys the panel answers itself, and the window's shortcuts leave alone while
 * the keyboard is in here. mod+. stops an answer, where elsewhere it is Zen
 * Mode.
 */
const STOP_KEY = "mod+.";
const ACCEPT_ALL_KEY = "mod+enter";
const REJECT_ALL_KEY = "mod+backspace";
const PANEL_KEYS = [STOP_KEY, ACCEPT_ALL_KEY, REJECT_ALL_KEY].join(",");

const TOO_LONG = "This note is too long to send. Select a section instead.";

type Prepared = { ok: true; context: AiContext | null } | { ok: false; message: string };

/** What a question would send about the note, without sending it. */
function prepare(note: NoteSnapshot | null, wholeNote: boolean): Prepared {
  if (!note) return { ok: true, context: null };
  const built = buildContext({ path: note.path, text: note.text, selection: note.selection, wholeNote });
  if (!built.ok) return { ok: false, message: TOO_LONG };
  // With only the selection allowed and nothing selected, no note text goes.
  if (built.context.selectionOnly && !built.context.note) return { ok: true, context: null };
  return { ok: true, context: built.context };
}

/**
 * The AI panel, docked on the left: what the note's context is, the
 * conversation so far, and a place to ask. Only ever opened by the person,
 * with mod+L - nothing else in the app points at it.
 */
const AiPanel = forwardRef<AiPanelHandle, AiPanelProps>(function AiPanel(
  {
    isOpen,
    width,
    isResizing,
    onResizeStart,
    onResizeReset,
    readNote,
    sendWholeNote,
    vaultPath,
    modelChoices,
    setModelChoices,
    onClose,
    onReturnFocus,
    onOpenSettings,
    viewFor,
    openNote,
    openAt,
    instructions,
    memory,
    onRemember,
    notes,
  },
  ref
) {
  const agent = useAgent();
  const label = agent.state?.label ?? "the agent";
  const chat = useAiChat(label, { viewFor, vault: vaultPath });
  const config = agent.state?.agent ?? null;

  const [question, setQuestion] = useState("");
  const [intent, setIntent] = useState<Intent>("ask");
  const [prepared, setPrepared] = useState<Prepared>({ ok: true, context: null });
  const [models, setModels] = useState<ModelInfo[]>([]);
  const composer = useRef<ComposerHandle>(null);
  const [showThreads, setShowThreads] = useState(false);
  /** The conversation, or the notes to pick for its context. */
  const [view, setView] = useState<PanelView>("chat");
  /** Notes picked in the Files view, to go with every question. */
  const [picked, setPicked] = useState<string[]>([]);
  /** Lines pinned with mod+L. */
  const [pinned, setPinned] = useState<PinnedLines[]>([]);
  /** What there is to act on: a selection, or at least a word at the caret. */
  const [selection, setSelection] = useState({ selected: false, onWord: false });
  /** A line from the panel itself, that goes again after a moment. */
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 3500);
    return () => window.clearTimeout(timer);
  }, [flash]);
  const scroller = useRef<HTMLDivElement>(null);

  /** Looks at the note again, for the chips. */
  const [notePath, setNotePath] = useState<string | null>(null);
  const look = useCallback(() => {
    const note = readNote();
    setPrepared(prepare(note, sendWholeNote));
    setNotePath(note?.path ?? null);
    const selected = !!note && note.selection.to > note.selection.from;
    const onWord = !!note && !selected && !!wordAt(note.text, note.selection.from);
    setSelection({ selected, onWord });
  }, [readNote, sendWholeNote]);

  useImperativeHandle(
    ref,
    () => ({
      focusComposer(next) {
        setIntent(next);
        look();
        setView("chat");
        // mod+L over a selection pins those lines to the context: they stay
        // with the next questions however the selection moves after.
        const note = readNote();
        if (note && note.selection.to > note.selection.from) {
          const [first, last] = selectionLines(note.text, note.selection);
          const id = `${note.path}:${first}-${last}`;
          const text = note.text
            .split("\n")
            .slice(first - 1, last)
            .join("\n");
          setPinned((list) =>
            list.some((pin) => pin.id === id)
              ? list
              : [...list, { id, path: note.path, title: fileName(note.path), first, last, text }]
          );
        }
        // Once the panel is no longer `inert`, which it is until it opens.
        requestAnimationFrame(() => composer.current?.focus());
      },
    }),
    [look, readNote]
  );

  // Opening the panel is the person going looking for AI: the settings are
  // read again (they may have just turned an agent on), and either the agent
  // is started ahead of the question or what is installed is looked for.
  const { refresh, warm, detect, listModels } = agent;
  // Another agent's models mean nothing to this one: until this one has
  // said what it offers, there are none to pick from.
  const agentNow = agentKey(config);
  const [modelsFor, setModelsFor] = useState(agentNow);
  if (modelsFor !== agentNow) {
    setModelsFor(agentNow);
    setModels([]);
  }
  useEffect(() => {
    if (isOpen) void refresh();
  }, [isOpen, refresh]);
  useEffect(() => {
    if (!isOpen) return;
    if (!config) {
      void detect();
      return;
    }
    let current = true;
    void warm();
    void listModels().then((offered) => current && setModels(offered));
    return () => {
      current = false;
    };
  }, [isOpen, config, warm, detect, listModels]);

  // Kept at the newest words while they arrive, unless the person has
  // scrolled up to read something earlier.
  const lastTurn = chat.turns[chat.turns.length - 1];
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 80) box.scrollTop = box.scrollHeight;
  }, [lastTurn]);

  const model = modelToUse(modelChoices, config, vaultPath, models);

  /** Asks the agent `question`, about the note as it is now - or as `note` says it is. */
  const ask = useCallback(
    (
      question: string,
      shown: { text: string; action: string | null },
      as: Intent,
      note = readNote(),
      selected: Selected | null = null,
      extras: ContextExtra[] = []
    ) => {
      if (chat.running || !config) return;
      const now = prepare(note, sendWholeNote);
      setPrepared(now);
      if (!now.ok) return;
      setQuestion("");
      const context = now.context;
      let lines: string | null = null;
      if (context?.selection) {
        const [first, last] = selectionLines(context.note, context.selection);
        lines = first === last ? `L${first}` : `L${first}-${last}`;
      }
      void chat.ask({
        question,
        text: shown.text,
        action: shown.action,
        about: context ? { title: context.title, lines } : null,
        instructions,
        memory,
        path: note?.path ?? null,
        context,
        intent: as,
        model,
        selected,
        extras,
      });
    },
    [chat, config, readNote, sendWholeNote, model, instructions, memory]
  );

  /**
   * The note as the question will carry it, and what was added to it: the
   * picked notes, read as they are now, and the pinned lines. A pin on the
   * open note, with nothing selected there now, is marked in the note as its
   * selection rather than sent twice.
   */
  const gather = useCallback(async () => {
    let note = readNote();
    const extras: ContextExtra[] = [];
    let marked = false;
    for (const pin of pinned) {
      if (note && pin.path === note.path) {
        const live =
          note.selection.to > note.selection.from ? selectionLines(note.text, note.selection) : null;
        if (live && live[0] === pin.first && live[1] === pin.last) continue;
        if (!live && !marked) {
          note = { ...note, selection: offsetsOfLines(note.text, pin.first, pin.last) };
          marked = true;
          continue;
        }
      }
      const lines = pin.first === pin.last ? `line ${pin.first}` : `lines ${pin.first}–${pin.last}`;
      extras.push({ title: `${pin.title} (${lines})`, text: clip(pin.text, EXTRA_LIMIT) });
    }
    let total = extras.reduce((sum, extra) => sum + extra.text.length, 0);
    for (const path of picked) {
      if (path === note?.path || total >= EXTRAS_LIMIT) continue;
      try {
        const text = clip(
          await invoke<string>("read_file", { path }),
          Math.min(EXTRA_LIMIT, EXTRAS_LIMIT - total)
        );
        extras.push({ title: relativePath(vaultPath ?? "", path), text });
        total += text.length;
      } catch {
        // Gone since it was picked: it is left out, and the rest still go.
      }
    }
    return { note, extras };
  }, [readNote, pinned, picked, vaultPath]);

  /** Runs a writing action on what is selected - or, for a synonym, the word at the caret. */
  const run = useCallback(
    (action: WritingAction, rest: string) => {
      if (action.id === "remember") {
        if (!rest) {
          setFlash("Type what to remember after /remember.");
          return;
        }
        onRemember(rest);
        setQuestion("");
        setFlash("Remembered. It goes with every question in this vault.");
        return;
      }
      let note = readNote();
      let selected = !!note && note.selection.to > note.selection.from;
      if (note && !selected && action.needs === "word") {
        const word = wordAt(note.text, note.selection.from);
        if (word) {
          note = { ...note, selection: word };
          selected = true;
        }
      }
      if (!canRun(action, selected, false)) {
        setFlash(action.needs === "word" ? "Put the caret on a word first." : "Select some text first.");
        return;
      }
      // A change to what is selected stays inside it, however often the same
      // words appear elsewhere in the note.
      const scoped =
        note && selected && action.intent === "edit"
          ? {
              from: note.selection.from,
              to: note.selection.to,
              text: note.text.slice(note.selection.from, note.selection.to),
            }
          : null;
      ask(
        requestFor(action, selected, rest),
        { text: rest, action: action.label },
        action.intent,
        note,
        scoped
      );
    },
    [ask, onRemember, readNote]
  );

  /** Sends what was typed: a writing action when it starts with one, a question otherwise. */
  const send = useCallback(
    (text: string) => {
      const asked = text.trim();
      if (!asked) return;
      const command = parseCommand(asked);
      if (command) {
        run(command.action, command.rest);
        return;
      }
      void gather().then(({ note, extras }) =>
        ask(asked, { text: asked, action: null }, intent, note, null, extras)
      );
    },
    [ask, run, intent, gather]
  );

  const retry = useCallback(
    (turn: ChatTurn) => ask(turn.question, { text: turn.text, action: turn.action }, turn.intent),
    [ask]
  );

  // mod+. anywhere in the panel stops the answer.
  /** The note a turn's edits are over, when it is in an editor. */
  const editorOf = useCallback((turn: ChatTurn) => (turn.edits ? viewFor(turn.edits.path) : null), [viewFor]);

  /** Brings a turn's note forward, then draws its edits over it. */
  const show = useCallback(
    async (turn: ChatTurn) => {
      if (!turn.edits) return;
      if (!viewFor(turn.edits.path)) await openNote(turn.edits.path);
      requestAnimationFrame(() => chat.show(turn));
    },
    [viewFor, openNote, chat]
  );

  const decide = useCallback(
    (turn: ChatTurn, card: EditCard | null, accept: boolean) => {
      const view = editorOf(turn);
      if (!view) {
        void show(turn);
        return;
      }
      if (card) {
        if (accept) acceptProposal(view, card.id);
        else rejectProposal(view, card.id);
      } else if (accept) acceptAllProposals(view);
      else rejectAllProposals(view);
    },
    [editorOf, show]
  );

  const focus = useCallback(
    (turn: ChatTurn, card: EditCard | null) => {
      const view = editorOf(turn);
      if (!view) return;
      const edit = card && pendingEdits(view.state).find((pending) => pending.id === card.id);
      view.dispatch({
        effects: [
          focusProposal.of(edit ? edit.id : null),
          ...(edit ? [EditorView.scrollIntoView(edit.from, { y: "nearest" })] : []),
        ],
      });
    },
    [editorOf]
  );

  /** The latest answer with edits still waiting - over `path`, when one is given. */
  const waitingFor = useCallback(
    (path: string | null) =>
      [...chat.turns]
        .reverse()
        .find(
          (turn) =>
            (!path || turn.edits?.path === path) &&
            turn.edits?.cards.some((card) => card.status === "pending")
        ),
    [chat.turns]
  );
  const waiting = waitingFor(null);
  /** The first edit waiting, for Review to bring into view. */
  const reviewTarget = waiting?.edits?.shown
    ? { turn: waiting, card: waiting.edits.cards.find((card) => card.status === "pending")! }
    : null;

  const onPanelKey = (event: React.KeyboardEvent) => {
    const pressed = (binding: string) => matchesBinding(event.nativeEvent, binding);
    if (pressed(STOP_KEY)) {
      event.preventDefault();
      if (chat.running) chat.stop();
    } else if ((pressed(ACCEPT_ALL_KEY) || pressed(REJECT_ALL_KEY)) && waiting) {
      // Only with edits waiting: otherwise mod+backspace is the text box's own.
      event.preventDefault();
      decide(waiting, null, pressed(ACCEPT_ALL_KEY));
    }
  };

  /** What the next question carries: the open note, and what was added to it. */
  const chips = useMemo<ContextChip[]>(() => {
    const list: ContextChip[] = [];
    /** The open note's selected lines, which a pin of the same lines would only repeat. */
    let live: string | null = null;
    if (prepared.ok && prepared.context) {
      const { context } = prepared;
      let detail: string | null = null;
      if (context.selection) {
        const [first, last] = selectionLines(context.note, context.selection);
        detail = first === last ? `L${first}` : `L${first}–${last}`;
        live = `${notePath}:${first}-${last}`;
      }
      list.push({
        id: "note",
        kind: "note",
        label: context.title,
        detail,
        title: context.selectionOnly
          ? "Only the selection goes"
          : context.trimmed
            ? `${context.omittedLines} lines of it are left out, to fit`
            : "The open note goes with your question",
      });
    }
    for (const pin of pinned) {
      if (pin.id === live) continue;
      list.push({
        id: pin.id,
        kind: "lines",
        label: pin.title,
        detail: pin.first === pin.last ? `L${pin.first}` : `L${pin.first}–${pin.last}`,
        title: pin.text,
        onRemove: () => setPinned((all) => all.filter((other) => other.id !== pin.id)),
      });
    }
    for (const path of picked) {
      if (path === notePath) continue;
      list.push({
        id: path,
        kind: "file",
        label: fileName(path).replace(/\.md$/i, ""),
        title: relativePath(vaultPath ?? "", path),
        onRemove: () => setPicked((all) => all.filter((other) => other !== path)),
      });
    }
    return list;
  }, [prepared, pinned, picked, notePath, vaultPath]);

  /**
   * A fresh conversation has the composer in the middle of the panel, with
   * nothing above it; once the first question goes it settles at the foot,
   * under the answers. The move between the two is animated from where it
   * was to where it lands, so it slides rather than jumps.
   */
  const centered = view === "chat" && chat.turns.length === 0;
  const dock = useRef<HTMLDivElement>(null);
  const dockWas = useRef<{ top: number; centered: boolean } | null>(null);
  useLayoutEffect(() => {
    const box = dock.current;
    if (!box) return;
    const top = box.getBoundingClientRect().top;
    const was = dockWas.current;
    dockWas.current = { top, centered };
    if (!was || was.centered === centered || Math.abs(was.top - top) < 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    box.animate([{ transform: `translateY(${was.top - top}px)` }, { transform: "translateY(0)" }], {
      duration: 320,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
  });

  const used = lastTurn ? contextUsed(lastTurn.answer) : null;
  const signIn = config?.kind === "codex" ? () => void agent.login() : undefined;

  // The latest of everything a turn's buttons reach for, read when one is
  // pressed. Switching notes changes most of them, and the turns - each a
  // whole answer to lay out again - should not be drawn again for it.
  const reach = useRef({
    retry,
    decide,
    focus,
    show,
    openNote,
    markNote: chat.markNote,
    onOpenSettings,
    signIn,
  });
  useEffect(() => {
    reach.current = { retry, decide, focus, show, openNote, markNote: chat.markNote, onOpenSettings, signIn };
  });
  const canSignIn = !!signIn;
  const turnActions = useMemo<TurnActions>(
    () => ({
      onRetry: (turn) => reach.current.retry(turn),
      onOpenSettings: () => reach.current.onOpenSettings(),
      onSignIn: canSignIn ? () => reach.current.signIn?.() : undefined,
      onAccept: (turn, card) => reach.current.decide(turn, card, true),
      onReject: (turn, card) => reach.current.decide(turn, card, false),
      onAcceptAll: (turn) => reach.current.decide(turn, null, true),
      onRejectAll: (turn) => reach.current.decide(turn, null, false),
      onFocus: (turn, card) => reach.current.focus(turn, card),
      onShow: (turn) => void reach.current.show(turn),
      onCreateNote: (turn, note) => {
        invoke<string>("create_note", { path: note.path, content: note.content })
          .then((made) => {
            reach.current.markNote(turn.id, note.id, "created");
            void reach.current.openNote(made);
          })
          .catch((error) => reach.current.markNote(turn.id, note.id, "failed", String(error)));
      },
      onDiscardNote: (turn, note) => reach.current.markNote(turn.id, note.id, "discarded"),
    }),
    [canSignIn]
  );

  // The notes the agent has been shown, which its citations may open - asked
  // again whenever an answer finishes.
  const [citable, setCitable] = useState<ReadonlySet<string>>(new Set());
  const lastState = lastTurn?.answer.state;
  useEffect(() => {
    if (lastState !== "done") return;
    invoke<string[]>("agent_citable")
      .then((paths) => setCitable(new Set(paths)))
      .catch(() => setCitable(new Set()));
  }, [lastState, lastTurn?.id]);
  const citations = useMemo<Citations>(
    () => ({
      citable,
      open(path, paragraph) {
        invoke<{ path: string; line: number }>("agent_cite", { path, paragraph })
          .then((cited) => openAt(cited.path, cited.line))
          .catch((error) => report("Couldn't open that note", error));
      },
    }),
    [citable, openAt]
  );
  const cannotSearch =
    agent.state?.vaultSearch && agent.state.agentSearches === false
      ? `${label} can't search your vault, so nuza is sending the note text instead.`
      : null;

  return (
    <CitationContext.Provider value={citations}>
      <aside
        data-own-keys={PANEL_KEYS}
        onKeyDown={onPanelKey}
        aria-label="AI"
        className="relative flex h-full flex-col overflow-hidden rounded-t-lg bg-[var(--nuza-editor-tint)] text-sm"
        style={{ width }}
      >
        <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-zinc-800/80 px-3">
          <h2 className="truncate text-xs font-medium text-gray-300">{config ? label : "AI"}</h2>
          <div className="flex items-center gap-1">
            {config && (
              <button
                type="button"
                onClick={() => setShowThreads((shown) => !shown)}
                title="Chats"
                aria-label="Chats"
                aria-expanded={showThreads}
                className={cn(
                  "cursor-pointer rounded p-1 hover:bg-zinc-800 hover:text-white",
                  showThreads ? "text-white" : "text-gray-500"
                )}
              >
                <History size={13} />
              </button>
            )}
            {config && chat.turns.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setShowThreads(false);
                  chat.newChat();
                  setPinned([]);
                  setPicked([]);
                }}
                disabled={chat.running}
                title="New chat"
                aria-label="New chat"
                className="cursor-pointer rounded p-1 text-gray-500 hover:bg-zinc-800 hover:text-white disabled:cursor-default disabled:opacity-40"
              >
                <SquarePen size={13} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              title="Close"
              aria-label="Close the AI panel"
              className="cursor-pointer rounded p-1 text-gray-500 hover:bg-zinc-800 hover:text-white"
            >
              <X size={14} />
            </button>
          </div>
        </header>

        {config && showThreads && (
          <ThreadList
            threads={chat.threads}
            current={chat.threadId}
            onOpen={(id) => {
              setShowThreads(false);
              if (!chat.running) chat.openThread(id);
              requestAnimationFrame(() => composer.current?.focus());
            }}
            onDelete={chat.deleteThread}
            onNew={
              chat.turns.length > 0 && !chat.running
                ? () => {
                    setShowThreads(false);
                    chat.newChat();
                    requestAnimationFrame(() => composer.current?.focus());
                  }
                : undefined
            }
            onClose={() => {
              setShowThreads(false);
              composer.current?.focus();
            }}
          />
        )}

        {!config ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <SetupChecklist
              detection={agent.detection}
              starting={agent.starting}
              error={agent.error?.message ?? null}
              onUse={(preset) => void agent.use(preset.config)}
              onOpenSettings={onOpenSettings}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {view === "files" ? (
              <div className="flex min-h-0 flex-1 flex-col px-3 pt-3">
                <ContextFiles
                  notes={notes}
                  vault={vaultPath}
                  current={notePath}
                  picked={picked}
                  onToggle={(path) =>
                    setPicked((all) =>
                      all.includes(path) ? all.filter((other) => other !== path) : [...all, path]
                    )
                  }
                />
              </div>
            ) : centered ? (
              // A conversation not yet started: nothing above the composer,
              // which sits in the middle until the first question goes.
              <div className="flex-1" />
            ) : (
              <div ref={scroller} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-3">
                {chat.turns.map((turn) => (
                  <TurnView key={turn.id} turn={turn} agent={label} actions={turnActions} />
                ))}
              </div>
            )}

            <div ref={dock} className={cn("shrink-0 p-2", !centered && "border-t border-zinc-800/80")}>
              <div className="pb-1.5">
                <PanelSwitcher view={view} onChange={setView} picked={picked.length} />
              </div>
              {!prepared.ok && (
                <p role="alert" className="px-1 pb-1.5 text-xs text-amber-400">
                  {prepared.message}
                </p>
              )}
              {agent.error && chat.turns.length === 0 && (
                <p role="alert" className="px-1 pb-1.5 text-xs text-amber-400">
                  {agent.error.message}
                </p>
              )}
              {cannotSearch && <p className="px-1 pb-1.5 text-[11px] text-gray-500">{cannotSearch}</p>}
              <ContextChips
                chips={chips}
                reviewable={!!reviewTarget}
                onReview={() => reviewTarget && focus(reviewTarget.turn, reviewTarget.card)}
              />
              {flash && <p className="animate-ai-in px-1 pb-1.5 text-xs text-gray-400">{flash}</p>}
              <Composer
                ref={composer}
                value={question}
                onChange={setQuestion}
                onSend={(text) => {
                  setView("chat");
                  send(text);
                }}
                onStop={chat.stop}
                onAction={run}
                onEscape={onReturnFocus}
                onFocus={look}
                running={chat.running}
                intent={intent}
                selected={selection.selected}
                onWord={selection.onWord}
                models={models}
                model={model}
                onModel={(chosen) => setModelChoices(chooseModel(modelChoices, config, vaultPath, chosen))}
                used={used}
              />
            </div>
            {centered && <div className="flex-1" />}
          </div>
        )}

        {/* The handle is on the right, against the note; dragging right widens. */}
        <div
          onPointerDown={onResizeStart}
          onDoubleClick={onResizeReset}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the AI panel"
          title="Drag to resize, double-click to reset"
          className={cn(
            "absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize after:absolute after:inset-y-0 after:right-1 after:w-px after:transition-colors",
            isResizing ? "after:bg-[var(--nuza-accent)]" : "after:bg-transparent hover:after:bg-zinc-500"
          )}
        />
      </aside>
    </CitationContext.Provider>
  );
});

export default AiPanel;
