const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago `then` was, the way it would be said: "just now", "5 minutes
 * ago", "yesterday". Past a week the date says more than a count of days
 * does, so it is the date - with the year only when it is not this one.
 */
export function timeAgo(then: number, now: number, locale?: string): string {
  const elapsed = Math.max(0, now - then);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return plural(Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), "hour");
  if (elapsed < 2 * DAY) return "yesterday";
  if (elapsed < 7 * DAY) return plural(Math.floor(elapsed / DAY), "day");

  const date = new Date(then);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return `on ${date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })}`;
}

function plural(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

/** The whole date and time, for the tooltip behind the short form. */
export function fullDate(then: number, locale?: string): string {
  return new Date(then).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}
