import { Component, ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * What is left on screen when the app itself falls over.
 *
 * Nothing used to catch an error thrown while drawing, or in an effect, so
 * React took the whole tree down and the window went blank - no message, and
 * no way back but to quit. This says what happened and offers a reload.
 *
 * It does not try to save on the way down. By the time an error arrives here
 * the editor has been unmounted, and a note read back from an editor that is
 * gone reads as empty: writing that out would put a blank over the real file.
 * Autosave has already written everything but the last moment's typing.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("nuza stopped drawing:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main
        role="alert"
        className="flex h-screen flex-col items-center justify-center gap-4 px-8 text-center"
        style={{ backgroundColor: "var(--nuza-bg)", color: "var(--nuza-fg)" }}
      >
        <h1 className="text-base font-semibold" style={{ color: "var(--nuza-heading)" }}>
          Something went wrong
        </h1>
        <p className="max-w-md text-sm" style={{ color: "var(--nuza-muted)" }}>
          nuza ran into a problem it could not carry on from. Your notes are saved as you type, so reloading
          should bring everything back as it was.
        </p>
        <pre
          className="max-h-32 max-w-xl overflow-auto whitespace-pre-wrap rounded-md px-3 py-2 text-left text-xs"
          style={{ backgroundColor: "var(--nuza-surface)", color: "var(--nuza-muted)" }}
        >
          {error.message || String(error)}
        </pre>
        <button
          type="button"
          autoFocus
          onClick={() => window.location.reload()}
          className="cursor-pointer rounded-md px-4 py-1.5 text-sm font-medium"
          style={{ backgroundColor: "var(--nuza-accent)", color: "var(--nuza-bg)" }}
        >
          Reload
        </button>
      </main>
    );
  }
}
