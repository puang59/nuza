import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import type { EditorView } from "@codemirror/view";
import { reasonFor, report } from "@/lib/notices";
import type { AiContext } from "@/lib/ai/context";
import { buildFollowUp, buildPrompt, markedNote, type ContextExtra, type Intent } from "@/lib/ai/prompt";
import type { AgentEvent } from "@/lib/ai/protocol";
import {
  type Scope,
  afterRetry,
  againstLiveNote,
  editsIn,
  hasEditsBlock,
  newNotesIn,
  parseProposals,
  proseOf,
  retryRequest,
  type Proposal,
} from "@/lib/ai/proposals";
import { applyEvent, answerText, emptyAnswer, type Answer } from "@/lib/ai/transcript";
import {
  CONVERSATION_CLEARED,
  forgetThread,
  keepThread,
  loadThreads,
  newThreadId,
  pruneAllThreads,
  titleFor,
  type SavedTurn,
  type Thread,
} from "@/lib/ai/memory";
import { PROPOSAL_EVENT, setProposals, type ProposalEventDetail } from "@/lib/markdown/aiDiff";

/**
 * Where a proposed edit stands: waiting over the note, taken, turned down,
 * no longer matching the note, or replaced by a newer answer's edits.
 */
export type EditStatus = "pending" | "accepted" | "rejected" | "stale" | "replaced";

export interface EditCard {
  id: string;
  find: string;
  replace: string;
  why: string;
  status: EditStatus;
}

/**
 * What the writer selected when they asked for a change to just that: where
 * it was in the editor, and what it said. Edits for it go inside it.
 */
export interface Selected {
  from: number;
  to: number;
  text: string;
}

/** Where `selected` is in the note as it is now, if it is still there. */
function scopeIn(live: string, selected: Selected | null): Scope | null {
  if (!selected || !selected.text) return null;
  if (live.slice(selected.from, selected.to) === selected.text)
    return { from: selected.from, to: selected.to };
  const first = live.indexOf(selected.text);
  if (first !== -1 && live.indexOf(selected.text, first + 1) === -1)
    return { from: first, to: first + selected.text.length };
  return null;
}

export interface TurnEdits {
  /** The note they are for. */
  path: string;
  /** The selection they must stay inside, when the change was asked for it alone. */
  selected?: Selected | null;
  cards: EditCard[];
  /** Waiting on the one retry, for edits whose text did not line up. */
  aligning: boolean;
  /** Whether they are drawn over the note yet - not while it is not open. */
  shown: boolean;
  /** Something to say about edits that could not be shown. */
  problem: string | null;
}

/** A new note the agent suggested, and what became of it. */
export interface NoteCard {
  id: string;
  /** Where it would go in the vault. */
  path: string;
  content: string;
  why: string;
  status: "pending" | "created" | "discarded" | "failed";
  /** Why it could not be made, when it could not. */
  error: string | null;
}

export interface ChatTurn {
  id: number;
  /** What the agent was asked: the writer's words, or an action's request. */
  question: string;
  /** What the writer's message shows: what they typed. */
  text: string;
  /** The writing action it was, if it was one. */
  action: string | null;
  /** The note it is about, for the chip on the message. */
  about: { title: string; lines: string | null } | null;
  intent: Intent;
  /** What was sent about the note with this question, if anything. */
  context: AiContext | null;
  answer: Answer;
  edits: TurnEdits | null;
  /** New notes it suggested, to be made only once the writer says so. */
  notes?: NoteCard[] | null;
  /** When it was asked, and how long the answer took once it came. */
  startedAt: number;
  took: number | null;
}

export interface AskInput {
  question: string;
  text: string;
  action: string | null;
  about: ChatTurn["about"];
  /** The writer's own instructions, and what they asked to be remembered. */
  instructions: string;
  memory: string[];
  /** The note the question is about, for its edits to go over. */
  path: string | null;
  context: AiContext | null;
  intent: Intent;
  model: string | null;
  /** For a change to the selection alone: the selection, which its edits stay inside. */
  selected?: Selected | null;
  /** Other notes, or lines of them, the writer added to the context. */
  extras?: ContextExtra[];
}

export interface NoteAccess {
  /** The editor showing the note at `path`, if one is. */
  viewFor: (path: string) => EditorView | null;
  /** The vault the conversation is kept for. */
  vault: string | null;
}

/** A kept turn, back as one the panel can show. */
function restored(saved: SavedTurn, id: number): ChatTurn {
  const answer = {
    ...emptyAnswer(),
    parts: saved.answer ? [{ type: "text" as const, text: saved.answer }] : [],
    state: saved.failed ? ("failed" as const) : ("done" as const),
    stopReason: saved.failed ? null : "end_turn",
    error: saved.failed ? { code: "other" as const, message: saved.failed } : null,
  };
  return {
    id,
    question: saved.request,
    text: saved.text,
    action: saved.action,
    about: saved.about,
    intent: "ask",
    context: null,
    answer,
    edits: null,
    startedAt: 0,
    took: saved.took,
  };
}

/** A finished turn, as it is kept. */
function kept(turn: ChatTurn): SavedTurn {
  return {
    request: turn.question,
    text: turn.text,
    action: turn.action,
    about: turn.about,
    answer: proseOf(answerText(turn.answer)),
    failed: turn.answer.state === "failed" ? (turn.answer.error?.message ?? "It didn't answer.") : null,
    took: turn.took,
  };
}

const PROBLEMS: Record<string, string> = {
  malformed: "The suggested changes couldn't be read, so none are shown.",
  "too-many": "The agent suggested too many changes at once, so none are shown. Ask for fewer.",
  "too-long":
    "A suggested change was too long to line up safely, so none are shown. Select a smaller section.",
  overlap: "The suggested changes overlapped each other, so none are shown.",
};

const OUTSIDE = "A suggested change was outside what you selected, so it was left out.";

function cardsFor(proposals: Proposal[], status: EditStatus): EditCard[] {
  return proposals.map(({ id, find, replace, why }) => ({ id, find, replace, why, status }));
}

/** Runs one prompt, passing its events to `onEvent`, and gives back its final answer. */
async function prompt(
  text: string,
  inFull: string | null,
  notePath: string | null,
  model: string | null,
  onEvent: (event: AgentEvent) => void
): Promise<Answer> {
  let answer = emptyAnswer();
  const channel = new Channel<AgentEvent>();
  channel.onmessage = (event) => {
    answer = applyEvent(answer, event);
    onEvent(event);
  };
  try {
    await invoke("agent_prompt", { text, inFull, notePath, model, onEvent: channel });
  } catch (error) {
    answer = { ...answer, state: "failed", error: { code: "other", message: reasonFor(error) } };
  }
  return answer;
}

/**
 * One window's conversation with its agent: the turns so far, the one in
 * flight, the edits each answer proposed, and stopping it. The conversation
 * is kept per vault, on this computer, so it is there after a restart - and
 * so a fresh session of the agent can be told what was said.
 */
export function useAiChat(agent: string, access: NoteAccess) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const nextId = useRef(0);
  const vault = access.vault;

  const notes = useRef(access);
  notes.current = access;
  /**
   * The note as this conversation was last given it. While it has not
   * changed, a follow-up does not send it again - the agent has it - and the
   * whole thing goes alongside in case the agent has lost the conversation.
   */
  const lastNote = useRef<string | null>(null);
  /** Edits turned down since the last question, to be mentioned in the next. */
  const declined = useRef<{ find: string; replace: string }[]>([]);
  const cards = useRef(new Map<string, EditCard>());

  /** The vault's threads, newest first, and the one open in the panel. */
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadId, setThreadId] = useState(() => newThreadId());
  /** The finished turns as a thread was opened: not a change, so not saved. */
  const opened = useRef("");

  /** Puts `thread`'s turns in the panel - or none, for a new one. */
  const open = useCallback((thread: Thread | null) => {
    const turns = thread ? thread.turns.map((turn) => restored(turn, ++nextId.current)) : [];
    opened.current = turns.map((turn) => `${turn.id}:${turn.answer.state}`).join(",");
    lastNote.current = null;
    declined.current = [];
    setThreadId(thread?.id ?? newThreadId());
    setTurns(turns);
  }, []);

  // The vault's threads, with the latest open as it was left - and every
  // vault's week-old ones cleared out on the way.
  useEffect(() => {
    pruneAllThreads();
    const kept = loadThreads(vault);
    setThreads(kept);
    open(kept[0] ?? null);
  }, [vault, open]);

  // Cleared from Settings, they go from the panel too - and the agent starts
  // a conversation that does not have them.
  useEffect(() => {
    function onCleared(event: Event) {
      if ((event as CustomEvent<string | null>).detail !== vault) return;
      setThreads([]);
      open(null);
      invoke("agent_new_chat").catch(() => {});
    }
    window.addEventListener(CONVERSATION_CLEARED, onCleared);
    return () => window.removeEventListener(CONVERSATION_CLEARED, onCleared);
  }, [vault, open]);

  // And the open thread kept as it goes, each time an answer finishes.
  const finished = turns.filter((turn) => turn.answer.state !== "streaming" && !turn.edits?.aligning);
  const finishedKey = finished.map((turn) => `${turn.id}:${turn.answer.state}`).join(",");
  const latest = useRef(turns);
  useEffect(() => {
    latest.current = turns;
  }, [turns]);
  useEffect(() => {
    if (!finishedKey || finishedKey === opened.current) return;
    const saved = latest.current.filter((turn) => turn.answer.state !== "streaming").map(kept);
    setThreads(
      keepThread(vault, { id: threadId, title: titleFor(saved), updatedAt: Date.now(), turns: saved })
    );
  }, [finishedKey, vault, threadId]);

  const update = useCallback((id: number, change: (turn: ChatTurn) => ChatTurn) => {
    setTurns((all) => all.map((turn) => (turn.id === id ? change(turn) : turn)));
  }, []);

  const updateEdits = useCallback(
    (id: number, change: Partial<TurnEdits>) =>
      update(id, (turn) => (turn.edits ? { ...turn, edits: { ...turn.edits, ...change } } : turn)),
    [update]
  );

  // A proposal leaving the note - accepted or rejected from the note itself,
  // or typed over - is said on its card.
  useEffect(() => {
    function onDecided(event: Event) {
      const { id, outcome } = (event as CustomEvent<ProposalEventDetail>).detail;
      const card = cards.current.get(id);
      if (!card || card.status !== "pending") return;
      const status: EditStatus = outcome === "dropped" ? "stale" : outcome;
      if (status === "rejected") declined.current.push({ find: card.find, replace: card.replace });
      card.status = status;
      setTurns((all) =>
        all.map((turn) =>
          turn.edits?.cards.some((c) => c.id === id)
            ? {
                ...turn,
                edits: {
                  ...turn.edits,
                  cards: turn.edits.cards.map((c) => (c.id === id ? { ...c, status } : c)),
                },
              }
            : turn
        )
      );
    }
    window.addEventListener(PROPOSAL_EVENT, onDecided);
    return () => window.removeEventListener(PROPOSAL_EVENT, onDecided);
  }, []);

  /**
   * Draws a turn's edits over its note, checked against the note as it is
   * now: anything the person has since typed over is set aside, not moved.
   * Earlier answers' edits still waiting are replaced by these.
   */
  const place = useCallback(
    (
      id: number,
      path: string,
      proposals: Proposal[],
      problem: string | null,
      selected: Selected | null = null
    ) => {
      const view = notes.current.viewFor(path);
      if (!view) {
        const waiting = cardsFor(proposals, "pending");
        for (const card of waiting) cards.current.set(card.id, card);
        updateEdits(id, { cards: waiting, aligning: false, shown: false, problem });
        return;
      }
      const live = view.state.doc.toString();
      const { fresh, stale } = againstLiveNote(proposals, live, scopeIn(live, selected));
      // Older edits still waiting give way to these.
      setTurns((all) =>
        all.map((turn) =>
          turn.id !== id && turn.edits?.cards.some((card) => card.status === "pending")
            ? {
                ...turn,
                edits: {
                  ...turn.edits,
                  cards: turn.edits.cards.map((card) =>
                    card.status === "pending" ? { ...card, status: "replaced" as const } : card
                  ),
                },
              }
            : turn
        )
      );
      for (const card of cards.current.values()) if (card.status === "pending") card.status = "replaced";
      const shown = [...cardsFor(fresh, "pending"), ...cardsFor(stale, "stale")];
      for (const card of shown) cards.current.set(card.id, card);
      view.dispatch({
        effects: setProposals.of(
          fresh.map(({ id, from, to, replace, why }) => ({ id, from, to, replace, why }))
        ),
      });
      const allStale = !fresh.length && stale.length > 0;
      updateEdits(id, {
        cards: shown,
        aligning: false,
        shown: true,
        problem: allStale ? "The note has changed since, so these no longer match it." : problem,
      });
    },
    [updateEdits]
  );

  /** Reads a finished answer's edits, with the one retry for anchors that did not line up. */
  const settle = useCallback(
    async (
      id: number,
      path: string,
      context: AiContext,
      answer: Answer,
      model: string | null,
      selected: Selected | null
    ) => {
      const text = answerText(answer);
      if (!hasEditsBlock(text)) return;
      // Only new notes in the block: nothing to draw over this one, and the
      // edits waiting from earlier stay as they are.
      const read = editsIn(text);
      if (read.ok && read.edits.length === 0) return;
      update(id, (turn) => ({
        ...turn,
        edits: { path, selected, cards: [], aligning: false, shown: false, problem: null },
      }));
      // Asked for a change to the selection alone: its edits go inside it.
      const scope = selected && context.selection ? context.selection : null;
      const parsed = parseProposals(text, context.note, scope);
      if (parsed.ok) {
        place(id, path, parsed.proposals, null, selected);
        return;
      }
      if (
        parsed.reason !== "anchor-missing" &&
        parsed.reason !== "anchor-ambiguous" &&
        parsed.reason !== "outside-selection"
      ) {
        updateEdits(id, { problem: PROBLEMS[parsed.reason] ?? null });
        return;
      }

      // One retry, never two, and not shown as a question of its own.
      updateEdits(id, { aligning: true });
      const failed = parsed.failed ?? [];
      const retry = await prompt(retryRequest(failed, !!scope), null, path, model, () => {});
      const { proposals, unplaced } =
        retry.state === "done"
          ? afterRetry(parsed.resolved ?? [], failed.length, answerText(retry), context.note, scope)
          : { proposals: parsed.resolved ?? [], unplaced: failed.length };
      const problem = !unplaced
        ? null
        : scope
          ? OUTSIDE
          : `I couldn't line ${unplaced === 1 ? "one change" : `${unplaced} changes`} up with your note — try selecting a smaller section.`;
      if (proposals.length) place(id, path, proposals, problem, selected);
      else updateEdits(id, { aligning: false, problem });
    },
    [place, update, updateEdits]
  );

  const running = turns.some((turn) => turn.answer.state === "streaming" || turn.edits?.aligning);

  const ask = useCallback(
    async ({
      question,
      text,
      action,
      about,
      instructions,
      memory,
      path,
      context,
      intent,
      model,
      selected = null,
      extras,
    }: AskInput) => {
      const id = ++nextId.current;
      // What was said before, for an agent that turns out not to have it.
      const history = latest.current
        .filter((turn) => turn.answer.state === "done")
        .map((turn) => ({ question: turn.question, answer: proseOf(answerText(turn.answer)) }))
        .filter((turn) => turn.answer);
      const input = {
        agent,
        question,
        context,
        intent,
        declined: declined.current,
        instructions,
        memory,
        history,
        extras,
      };
      const full = buildPrompt(input);
      // Everything that was sent about the notes: a follow-up only leaves it
      // out when none of it has changed since.
      const note =
        (context ? `${context.title}\n${markedNote(context)}` : "") +
        (extras ?? []).map((extra) => `\n\n${extra.title}\n${extra.text}`).join("");
      const unchanged = lastNote.current !== null && lastNote.current === note;
      const sent = unchanged ? buildFollowUp(input) : full;
      lastNote.current = note;
      declined.current = [];

      const startedAt = Date.now();
      setTurns((all) => [
        ...all,
        {
          id,
          question,
          text,
          action,
          about,
          intent,
          context,
          answer: emptyAnswer(),
          edits: null,
          startedAt,
          took: null,
        },
      ]);

      const answer = await prompt(sent, unchanged ? full : null, path, model, (event) => {
        // A turn that did not finish may not have reached the agent whole, so
        // the next one sends everything again.
        if (event.kind === "failed") lastNote.current = null;
        update(id, (turn) => ({
          ...turn,
          answer: applyEvent(turn.answer, event),
          took: event.kind === "done" || event.kind === "failed" ? Date.now() - startedAt : turn.took,
        }));
      });
      if (answer.state === "failed") {
        lastNote.current = null;
        update(id, (turn) => ({ ...turn, answer: turn.answer.state === "failed" ? turn.answer : answer }));
        return;
      }
      // New notes it suggested, with or without a note open.
      const suggested = answer.state === "done" ? newNotesIn(answerText(answer)) : [];
      if (suggested.length) {
        update(id, (turn) => ({
          ...turn,
          notes: suggested.map((note, index) => ({
            id: `note-${id}-${index}`,
            ...note,
            status: "pending" as const,
            error: null,
          })),
        }));
      }
      if (answer.state === "done" && context && path)
        await settle(id, path, context, answer, model, selected);
    },
    [agent, update, settle]
  );

  /** Draws a turn's edits over its note, once that note is open. */
  const show = useCallback(
    (turn: ChatTurn) => {
      if (!turn.edits) return;
      const waiting = turn.edits.cards.filter((card) => card.status === "pending");
      const view = notes.current.viewFor(turn.edits.path);
      if (!view || !waiting.length) return;
      // Found again from their text: where they were is from the note as it was.
      const live = view.state.doc.toString();
      const proposals = waiting.flatMap((card) => {
        const from = live.indexOf(card.find);
        return [{ ...card, from, to: from + card.find.length }];
      });
      place(turn.id, turn.edits.path, proposals, turn.edits.problem, turn.edits.selected ?? null);
    },
    [place]
  );

  const stop = useCallback(() => {
    invoke("agent_cancel").catch((error) => report("Couldn't stop the answer", error));
  }, []);

  /** Starts over: a new conversation, with nothing carried across. */
  /** Starts a new thread. The one open is kept, to come back to. */
  const newChat = useCallback(() => {
    open(null);
    invoke("agent_new_chat").catch((error) => console.error("Couldn't start a new conversation:", error));
  }, [open]);

  /**
   * Opens another thread. The agent starts a fresh session, and the thread's
   * turns go with the next question - as they would after a restart.
   */
  const openThread = useCallback(
    (id: string) => {
      if (id === threadId) return;
      const thread = loadThreads(vault).find((kept) => kept.id === id);
      if (!thread) return;
      open(thread);
      invoke("agent_new_chat").catch((error) => console.error("Couldn't switch conversations:", error));
    },
    [open, threadId, vault]
  );

  /** Forgets a thread; forgetting the open one starts a new one. */
  const deleteThread = useCallback(
    (id: string) => {
      setThreads(forgetThread(vault, id));
      if (id === threadId) newChat();
    },
    [newChat, threadId, vault]
  );

  /** What became of a suggested note. */
  const markNote = useCallback(
    (turnId: number, noteId: string, status: NoteCard["status"], error: string | null = null) =>
      update(turnId, (turn) => ({
        ...turn,
        notes: turn.notes?.map((note) => (note.id === noteId ? { ...note, status, error } : note)) ?? null,
      })),
    [update]
  );

  return {
    turns,
    running,
    ask,
    show,
    stop,
    newChat,
    threads,
    threadId,
    openThread,
    deleteThread,
    markNote,
  };
}
