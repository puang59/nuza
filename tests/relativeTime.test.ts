import { describe, expect, test } from "bun:test";
import { timeAgo } from "../src/lib/relativeTime";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = new Date(2026, 9, 8, 12, 0, 0).getTime();

describe("timeAgo", () => {
  test("says it the way it would be said", () => {
    expect(timeAgo(now - 20_000, now)).toBe("just now");
    expect(timeAgo(now - MINUTE, now)).toBe("1 minute ago");
    expect(timeAgo(now - 5 * MINUTE, now)).toBe("5 minutes ago");
    expect(timeAgo(now - HOUR, now)).toBe("1 hour ago");
    expect(timeAgo(now - 23 * HOUR, now)).toBe("23 hours ago");
    expect(timeAgo(now - 30 * HOUR, now)).toBe("yesterday");
    expect(timeAgo(now - 3 * DAY, now)).toBe("3 days ago");
  });

  test("past a week it is the date, with the year only when it is another one", () => {
    expect(timeAgo(new Date(2026, 8, 20).getTime(), now, "en-US")).toBe("on Sep 20");
    expect(timeAgo(new Date(2025, 2, 3).getTime(), now, "en-US")).toBe("on Mar 3, 2025");
  });

  // A clock that is a little behind the disk's must not say "in the future".
  test("a time ahead of now is just now", () => {
    expect(timeAgo(now + 5_000, now)).toBe("just now");
  });
});
