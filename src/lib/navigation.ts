/**
 * Where you have been, for going back to.
 *
 * Following a link, opening a search hit or switching notes moves you
 * somewhere else, and until now there was no way back but to find the tab and
 * scroll. Each of those moves leaves the place it left on a stack; going back
 * takes the top of it and puts where you were on the stack for going forward
 * again, the way a browser's two buttons work.
 */
export interface Place {
  path: string;
  /** The caret, as an offset into the note. */
  caret: number;
}

export interface Trail {
  back: Place[];
  forward: Place[];
}

export const EMPTY_TRAIL: Trail = { back: [], forward: [] };

/** How many places are kept behind you. */
export const TRAIL_LIMIT = 50;

function same(a: Place | undefined, b: Place) {
  return !!a && a.path === b.path && a.caret === b.caret;
}

/** Leaves `from` behind on the way to somewhere new, which ends any way forward. */
export function leave(trail: Trail, from: Place, limit = TRAIL_LIMIT): Trail {
  // The same place twice running is one place.
  const back = same(trail.back[trail.back.length - 1], from) ? trail.back : [...trail.back, from];
  return { back: back.slice(-limit), forward: [] };
}

/**
 * Steps one place back (or forward) from `here`. Returns the place to go to
 * and the trail as it then stands, or null when there is nowhere to go.
 */
export function step(trail: Trail, here: Place, direction: "back" | "forward") {
  const [from, onto] = direction === "back" ? [trail.back, trail.forward] : [trail.forward, trail.back];
  if (from.length === 0) return null;

  const to = from[from.length - 1];
  const rest = from.slice(0, -1);
  const other = [...onto, here];
  return {
    to,
    trail: direction === "back" ? { back: rest, forward: other } : { back: other, forward: rest },
  };
}

/** The trail with every path renamed, after a file or folder moves. */
export function renamePlaces(trail: Trail, rename: (path: string) => string): Trail {
  const moved = (places: Place[]) => places.map((place) => ({ ...place, path: rename(place.path) }));
  return { back: moved(trail.back), forward: moved(trail.forward) };
}

/** The trail without the places that match, after a delete. */
export function forgetPlaces(trail: Trail, gone: (path: string) => boolean): Trail {
  const kept = (places: Place[]) => places.filter((place) => !gone(place.path));
  return { back: kept(trail.back), forward: kept(trail.forward) };
}
