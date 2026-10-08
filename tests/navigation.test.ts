import { describe, expect, test } from "bun:test";
import { EMPTY_TRAIL, forgetPlaces, leave, renamePlaces, step } from "../src/lib/navigation";

const at = (path: string, caret = 0) => ({ path, caret });

describe("the trail of places", () => {
  test("going back returns to where you left, and forward to where you went back from", () => {
    let trail = leave(EMPTY_TRAIL, at("a.md", 10));
    trail = leave(trail, at("b.md", 20));

    // Now on c.md.
    const back = step(trail, at("c.md", 5), "back")!;
    expect(back.to).toEqual(at("b.md", 20));

    const again = step(back.trail, at("b.md", 20), "back")!;
    expect(again.to).toEqual(at("a.md", 10));
    expect(step(again.trail, at("a.md", 10), "back")).toBeNull();

    const forward = step(again.trail, at("a.md", 10), "forward")!;
    expect(forward.to).toEqual(at("b.md", 20));
    expect(step(forward.trail, at("b.md", 20), "forward")!.to).toEqual(at("c.md", 5));
  });

  test("going somewhere new ends the way forward", () => {
    const trail = leave(EMPTY_TRAIL, at("a.md"));
    const back = step(trail, at("b.md"), "back")!;
    expect(back.trail.forward).toHaveLength(1);
    expect(leave(back.trail, at("a.md", 3)).forward).toEqual([]);
  });

  test("the same place twice running is one place", () => {
    const once = leave(EMPTY_TRAIL, at("a.md", 4));
    expect(leave(once, at("a.md", 4)).back).toHaveLength(1);
    expect(leave(once, at("a.md", 9)).back).toHaveLength(2);
  });

  test("only so many places are kept, the oldest going first", () => {
    let trail = EMPTY_TRAIL;
    for (let caret = 0; caret < 5; caret++) trail = leave(trail, at("a.md", caret), 3);
    expect(trail.back.map((place) => place.caret)).toEqual([2, 3, 4]);
  });

  test("places follow a rename and go with a delete", () => {
    const trail = { back: [at("old/a.md", 1), at("b.md", 2)], forward: [at("old/c.md", 3)] };
    const renamed = renamePlaces(trail, (path) => path.replace(/^old\//, "new/"));
    expect(renamed.back[0].path).toBe("new/a.md");
    expect(renamed.forward[0].path).toBe("new/c.md");

    const forgotten = forgetPlaces(trail, (path) => path.startsWith("old/"));
    expect(forgotten).toEqual({ back: [at("b.md", 2)], forward: [] });
  });
});
