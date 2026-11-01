import { memo } from "react";
import { Check, ChevronRight, FilePlus, FileText, LoaderCircle, X } from "lucide-react";
import { cn } from "cn";
import { tookFor } from "@/lib/ai/time";
import type { ChatTurn, EditCard, NoteCard } from "@/hooks/useAiChat";
import type { AgentErrorKind } from "@/lib/ai/protocol";
import { forDisplay } from "@/lib/ai/answerMarkdown";
import { hasEditsBlock, proseOf } from "@/lib/ai/proposals";
import { stepTitle } from "@/lib/ai/transcript";
import AnswerText from "./AnswerText";

export interface TurnActions {
  onRetry: (turn: ChatTurn) => void;
  onOpenSettings: () => void;
  onSignIn?: () => void;
  onAccept?: (turn: ChatTurn, card: EditCard) => void;
  onReject?: (turn: ChatTurn, card: EditCard) => void;
  onAcceptAll?: (turn: ChatTurn) => void;
  onRejectAll?: (turn: ChatTurn) => void;
  /** A card is being looked at (or no longer is): its change is marked in the note. */
  onFocus?: (turn: ChatTurn, card: EditCard | null) => void;
  /** Draws the turn's edits over its note, once it is open. */
  onShow?: (turn: ChatTurn) => void;
  /** Makes a note the agent suggested, and opens it. */
  onCreateNote?: (turn: ChatTurn, note: NoteCard) => void;
  onDiscardNote?: (turn: ChatTurn, note: NoteCard) => void;
}

/** How much of a suggested note shows before it is made. */
const PREVIEW_LINES = 12;

/** The new notes a turn suggested: each made only when the writer says so. */
function NewNotes({ turn, actions }: { turn: ChatTurn; actions: TurnActions }) {
  if (!turn.notes?.length) return null;
  return (
    <div className="space-y-2 pt-1">
      {turn.notes.map((note) => {
        const lines = note.content.split("\n");
        const preview = lines.slice(0, PREVIEW_LINES).join("\n");
        return (
          <div
            key={note.id}
            className={cn(
              "animate-ai-in space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 text-xs",
              note.status !== "pending" && "opacity-70"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-gray-300">
                <FilePlus size={12} className="shrink-0 text-[var(--nuza-accent)]" aria-hidden />
                <span className="text-gray-500">New note</span>
                <span className="truncate font-medium">{note.path}</span>
              </span>
              {note.status === "created" && <span className="shrink-0 text-gray-500">Created</span>}
              {note.status === "discarded" && <span className="shrink-0 text-gray-500">Discarded</span>}
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-950/60 p-2 font-mono text-[11px] leading-snug text-gray-300">
              {preview}
              {lines.length > PREVIEW_LINES ? `\n… ${lines.length - PREVIEW_LINES} more lines` : ""}
            </pre>
            {note.why && <p className="text-gray-500">{note.why}</p>}
            {note.status === "failed" && note.error && <p className="text-amber-400/90">{note.error}</p>}
            {(note.status === "pending" || note.status === "failed") && (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className={SMALL_BUTTON}
                  onClick={() => actions.onDiscardNote?.(turn, note)}
                >
                  Discard
                </button>
                <button
                  type="button"
                  className={SMALL_BUTTON}
                  onClick={() => actions.onCreateNote?.(turn, note)}
                >
                  Create
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const SMALL_BUTTON =
  "cursor-pointer rounded-md border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-white transition-colors hover:border-[var(--nuza-accent)]";

/** What can be done about a failure, right where it is said. */
function Fix({ code, turn, actions }: { code: AgentErrorKind; turn: ChatTurn; actions: TurnActions }) {
  switch (code) {
    case "agent_missing":
    case "off":
      return (
        <button type="button" className={SMALL_BUTTON} onClick={actions.onOpenSettings}>
          Open AI settings
        </button>
      );
    case "not_signed_in":
      return (
        <div className="flex gap-2">
          {actions.onSignIn && (
            <button type="button" className={SMALL_BUTTON} onClick={actions.onSignIn}>
              Sign in
            </button>
          )}
          <button type="button" className={SMALL_BUTTON} onClick={() => actions.onRetry(turn)}>
            Try again
          </button>
        </div>
      );
    case "usage_limit":
    case "model_unavailable":
      // The limit is the agent's plan's, and nuza has nothing to sell about it;
      // a model the plan lacks is changed in the picker below.
      return null;
    default:
      return (
        <button type="button" className={SMALL_BUTTON} onClick={() => actions.onRetry(turn)}>
          Retry
        </button>
      );
  }
}

const STATUS: Record<Exclude<EditCard["status"], "pending">, string> = {
  accepted: "Accepted",
  rejected: "Rejected",
  stale: "This no longer matches the note",
  replaced: "Replaced by newer suggestions",
};

interface CardProps {
  card: EditCard;
  index: number;
  total: number;
  turn: ChatTurn;
  actions: TurnActions;
  shown: boolean;
}

/** One proposed edit: what goes, what comes, and why. */
function Card({ card, index, total, turn, actions, shown }: CardProps) {
  const pending = card.status === "pending";
  const look = (looking: boolean) => pending && shown && actions.onFocus?.(turn, looking ? card : null);
  return (
    <div
      className={`animate-ai-in rounded-md border p-2 text-xs ${pending ? "border-zinc-700 bg-zinc-900/60" : "border-zinc-800 opacity-60"}`}
      onMouseEnter={() => look(true)}
      onMouseLeave={() => look(false)}
    >
      <p className="mb-1 flex justify-between gap-2 text-[11px] text-gray-500">
        <span>
          Proposed edit {index + 1} of {total}
        </span>
        {card.status !== "pending" && <span>{STATUS[card.status]}</span>}
      </p>
      <div className="max-h-40 space-y-0.5 overflow-auto font-mono text-[11px] leading-snug">
        <p className="whitespace-pre-wrap border-l-2 border-red-500/70 bg-red-500/10 pl-1.5 text-gray-400 line-through decoration-red-400/70">
          {card.find}
        </p>
        {card.replace && (
          <p className="whitespace-pre-wrap border-l-2 border-green-500/70 bg-green-500/10 pl-1.5 text-gray-200">
            {card.replace}
          </p>
        )}
      </div>
      {card.why && <p className="mt-1 text-gray-500">{card.why}</p>}
      {pending && (
        <div className="mt-1.5 flex justify-end gap-2">
          <button type="button" className={SMALL_BUTTON} onClick={() => actions.onReject?.(turn, card)}>
            Reject
          </button>
          <button type="button" className={SMALL_BUTTON} onClick={() => actions.onAccept?.(turn, card)}>
            Accept
          </button>
        </div>
      )}
    </div>
  );
}

/** The edits an answer proposed, and where each stands. */
function Edits({ turn, actions }: { turn: ChatTurn; actions: TurnActions }) {
  const edits = turn.edits;
  if (!edits) return null;
  const pending = edits.cards.filter((card) => card.status === "pending");
  return (
    <div className="space-y-2 pt-1">
      {edits.aligning && (
        <p className="flex items-center gap-1.5 text-xs text-gray-500">
          <LoaderCircle size={12} className="animate-spin" /> Lining the changes up with your note…
        </p>
      )}
      {edits.cards.map((card, index) => (
        <Card
          key={card.id}
          card={card}
          index={index}
          total={edits.cards.length}
          turn={turn}
          actions={actions}
          shown={edits.shown}
        />
      ))}
      {edits.problem && <p className="text-xs text-amber-400/90">{edits.problem}</p>}
      {pending.length > 0 && !edits.shown && (
        <button type="button" className={SMALL_BUTTON} onClick={() => actions.onShow?.(turn)}>
          Show in the note
        </button>
      )}
      {pending.length > 1 && edits.shown && (
        <div className="flex justify-end gap-2">
          <button type="button" className={SMALL_BUTTON} onClick={() => actions.onRejectAll?.(turn)}>
            Reject all
          </button>
          <button type="button" className={SMALL_BUTTON} onClick={() => actions.onAcceptAll?.(turn)}>
            Accept all
          </button>
        </div>
      )}
    </div>
  );
}

interface TurnViewProps {
  turn: ChatTurn;
  /** What to call the agent: its own name, never nuza's. */
  agent: string;
  actions: TurnActions;
}

/** The writer's message: what it is about, the action if it was one, and their words. */
function Message({ turn }: { turn: ChatTurn }) {
  return (
    <div className="rounded-lg border border-zinc-700/60 bg-zinc-800/50 px-3 py-2 text-[13px] leading-relaxed text-gray-200">
      {turn.about && (
        <span className="mr-1.5 inline-flex items-center gap-1 align-baseline text-gray-300">
          <FileText size={12} className="self-center text-[var(--nuza-accent)]" aria-hidden />
          <span className="font-medium">{turn.about.title}</span>
          {turn.about.lines && <span className="text-gray-500">#{turn.about.lines}</span>}
        </span>
      )}
      {turn.action && (
        <span className="mr-1.5 rounded bg-[var(--nuza-accent-wash)] px-1.5 py-px text-[11px] font-medium text-[var(--nuza-accent)]">
          {turn.action}
        </span>
      )}
      {turn.text && <span className="whitespace-pre-wrap">{turn.text}</span>}
    </div>
  );
}

type Part = ChatTurn["answer"]["parts"][number];

/**
 * The agent's thinking and the steps it took, folded into one line - "Worked
 * for 12s" - that opens to show them. While it is still working, the line
 * says so, and what it is doing now.
 */
function Working({ parts, streaming, took }: { parts: Part[]; streaming: boolean; took: number | null }) {
  const work = parts.filter((part) => part.type === "thought" || part.type === "step");
  if (!work.length && !streaming) return null;
  const current = [...work].reverse().find((part) => part.type === "step");
  const summary = streaming
    ? current?.type === "step"
      ? stepTitle(current.title)
      : "Thinking…"
    : took
      ? `Worked for ${tookFor(took)}`
      : "Worked";
  return (
    <details className="group text-xs text-gray-500">
      <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 hover:text-gray-300">
        {streaming && <LoaderCircle size={12} className="shrink-0 animate-spin" aria-hidden />}
        <span className="truncate">{summary}</span>
        {work.length > 0 && (
          <ChevronRight size={12} className="shrink-0 transition-transform group-open:rotate-90" />
        )}
      </summary>
      <div className="mt-1.5 space-y-1 border-l border-zinc-800 pl-2.5">
        {work.map((part, index) =>
          part.type === "thought" ? (
            <p key={index} className="whitespace-pre-wrap text-gray-500">
              {part.text}
            </p>
          ) : part.type === "step" ? (
            <p key={index} className="flex items-center gap-1.5 text-gray-400">
              {part.status === "completed" ? (
                <Check size={12} aria-label="Done" className="shrink-0" />
              ) : part.status === "failed" ? (
                <X size={12} aria-label="Failed" className="shrink-0" />
              ) : (
                <LoaderCircle size={12} aria-label="Working" className="shrink-0 animate-spin" />
              )}
              <span className="truncate">{stepTitle(part.title)}</span>
            </p>
          ) : null
        )}
      </div>
    </details>
  );
}

/** One question and its answer, as it streams. */
function TurnView({ turn, agent, actions }: TurnViewProps) {
  const { answer } = turn;
  const streaming = answer.state === "streaming";
  const hasWords = answer.parts.some((part) => part.type === "text" && forDisplay(proseOf(part.text)).trim());

  return (
    <div className="animate-ai-in space-y-2.5">
      <Message turn={turn} />
      <Working parts={answer.parts} streaming={streaming && !hasWords} took={turn.took} />
      <div className="space-y-2 text-[13px] leading-relaxed text-gray-200">
        {answer.parts.map((part, index) => {
          switch (part.type) {
            case "text": {
              // The edits block is drawn as cards, not as the JSON it came in.
              const prose = forDisplay(proseOf(part.text)).trim();
              return prose ? <AnswerText key={index} text={prose} /> : null;
            }
            case "refused":
              return (
                <p key={index} className="animate-ai-in text-xs text-amber-400/90">
                  nuza didn&apos;t let {agent} {part.action}.
                </p>
              );
            case "notice":
              return (
                <p key={index} className="animate-ai-in text-xs italic text-gray-500">
                  {part.text}
                </p>
              );
            default:
              return null;
          }
        })}
      </div>
      {streaming && answer.parts.some((part) => part.type === "text" && hasEditsBlock(part.text)) && (
        <p className="flex items-center gap-1.5 text-xs text-gray-500">
          <LoaderCircle size={12} className="animate-spin" /> Writing the changes…
        </p>
      )}
      <Edits turn={turn} actions={actions} />
      <NewNotes turn={turn} actions={actions} />
      {answer.state === "done" && answer.stopReason === "cancelled" && (
        <p className="text-xs text-gray-500">Stopped.</p>
      )}
      {answer.state === "done" && answer.stopReason === "refusal" && (
        <p className="text-xs text-gray-500">{agent} declined to answer that.</p>
      )}
      {answer.state === "done" && answer.stopReason === "max_tokens" && (
        <p className="text-xs text-gray-500">{agent} ran out of room before it finished.</p>
      )}
      {answer.state === "done" &&
        !hasWords &&
        !turn.edits &&
        !turn.notes?.length &&
        answer.stopReason === "end_turn" && (
          <p className="text-xs text-gray-500">{agent} finished without saying anything.</p>
        )}
      {answer.state === "failed" && answer.error && (
        <div
          role="alert"
          className="animate-ai-in space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs"
        >
          <div className="text-amber-300">
            <AnswerText text={answer.error.message} />
          </div>
          <Fix code={answer.error.code} turn={turn} actions={actions} />
        </div>
      )}
    </div>
  );
}

/** Drawn again only when its own turn changes, not whenever the panel does. */
export default memo(TurnView);
