/**
 * Moving around the file tree with the keyboard.
 *
 * The tree is uncontrolled - a `<details>` owns whether its folder is open,
 * which is what keeps the whole panel cheap to draw - so what can be moved
 * between is whatever is on screen at this moment, read back off the DOM
 * rather than mirrored into state that would have to be kept in step with it.
 *
 * Rows are found by `data-path`: a file's button, and a folder's summary.
 */

/** Whether `node` is a folder that is currently folded shut. */
function isClosedFolder(node: Element) {
  return node.tagName === "DETAILS" && !node.hasAttribute("open");
}

/**
 * Whether `row` is folded away inside a closed folder.
 *
 * A closed folder's own row is not: it lives in the summary, which is the part
 * that stays on screen - only what comes after the summary is hidden.
 */
function isFoldedAway(row: Element, tree: Element) {
  for (let node = row.parentElement; node && node !== tree; node = node.parentElement) {
    if (!isClosedFolder(node)) continue;

    const summary = node.firstElementChild;
    if (summary && (summary === row || summary.contains(row))) continue;

    return true;
  }

  return false;
}

/** Every row on screen, in the order they are drawn. */
export function visibleRows(tree: Element): HTMLElement[] {
  const rows = Array.from(tree.querySelectorAll<HTMLElement>("[data-path]"));
  return rows.filter((row) => !isFoldedAway(row, tree));
}

/**
 * The row `step` places along from `from`. Stops at either end rather than
 * wrapping: a list that jumps from the bottom back to the top costs more in
 * lost bearings than it saves in keystrokes.
 */
export function rowAfter(rows: HTMLElement[], from: Element | null, step: number) {
  if (rows.length === 0) return undefined;

  const index = from ? rows.indexOf(from as HTMLElement) : -1;
  // Coming from nowhere - or from a row that has since gone - starts at the
  // near end, so the first press down lands on the first row.
  if (index === -1) return step > 0 ? rows[0] : rows[rows.length - 1];

  return rows[Math.min(Math.max(index + step, 0), rows.length - 1)];
}

/** The `<details>` a folder row belongs to, or null for a file row. */
export function folderOf(row: Element): HTMLDetailsElement | null {
  const details = row.parentElement;
  return details?.tagName === "DETAILS" && details.firstElementChild === row
    ? (details as HTMLDetailsElement)
    : null;
}

/** The row of the folder `row` sits inside, if it is not at the top level. */
export function parentRow(row: Element, tree: Element): HTMLElement | null {
  // Starting above this row's own folder, so a folder row finds the one it is
  // nested in rather than itself.
  const from = folderOf(row) ?? row;

  for (let node = from.parentElement; node && node !== tree; node = node.parentElement) {
    if (node.tagName !== "DETAILS") continue;

    const summary = node.firstElementChild;
    if (summary instanceof HTMLElement && summary.hasAttribute("data-path")) return summary;
  }

  return null;
}
