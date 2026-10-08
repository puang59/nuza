import { EditorView, ViewPlugin } from "@codemirror/view";

/** How long the scrollbar stays after the note stops moving. */
const LINGER_MS = 900;
/** How close to the scrollbar's edge the pointer has to be to call it up. */
const EDGE_PX = 18;

/**
 * Shows the note's scrollbar while it is of use and puts it away otherwise.
 *
 * The bar itself is drawn by the stylesheet (`.cm-scroller` in App.css), which
 * keeps it invisible until the scroller carries `data-scrollbar="shown"`. This
 * sets that: for as long as the note is being scrolled and a moment after, and
 * for as long as the pointer is over the lane the bar sits in.
 */
export const scrollbarOnDemand = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private atEdge = false;

    constructor(private readonly view: EditorView) {
      const scroller = view.scrollDOM;
      scroller.addEventListener("scroll", this.onScroll, { passive: true });
      scroller.addEventListener("mousemove", this.onMove, { passive: true });
      scroller.addEventListener("mouseleave", this.onLeave, { passive: true });
    }

    private show() {
      this.view.scrollDOM.dataset.scrollbar = "shown";
    }

    private hideSoon() {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.atEdge) delete this.view.scrollDOM.dataset.scrollbar;
      }, LINGER_MS);
    }

    private onScroll = () => {
      this.show();
      this.hideSoon();
    };

    private onMove = (event: MouseEvent) => {
      const { right } = this.view.scrollDOM.getBoundingClientRect();
      const atEdge = right - event.clientX <= EDGE_PX;
      if (atEdge === this.atEdge) return;

      this.atEdge = atEdge;
      if (atEdge) this.show();
      else this.hideSoon();
    };

    private onLeave = () => {
      if (!this.atEdge) return;
      this.atEdge = false;
      this.hideSoon();
    };

    destroy() {
      if (this.timer) clearTimeout(this.timer);
      const scroller = this.view.scrollDOM;
      scroller.removeEventListener("scroll", this.onScroll);
      scroller.removeEventListener("mousemove", this.onMove);
      scroller.removeEventListener("mouseleave", this.onLeave);
      delete scroller.dataset.scrollbar;
    }
  }
);
