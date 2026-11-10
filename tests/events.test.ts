import { describe, expect, test } from "bun:test";
import { EventBus } from "../src/lib/registries/events";

describe("the event bus", () => {
  test("hands each event to everyone listening for it, until they stop", () => {
    const bus = new EventBus();
    const heard: (string | null)[] = [];
    const first = bus.on("active-note-change", ({ path }) => heard.push(`first ${path}`));
    bus.on("active-note-change", ({ path }) => heard.push(`second ${path}`));

    bus.emit("active-note-change", { path: "a.md" });
    first.dispose();
    first.dispose();
    bus.emit("active-note-change", { path: "b.md" });

    expect(heard).toEqual(["first a.md", "second a.md", "second b.md"]);
  });

  test("keeps going past a listener that throws", () => {
    const bus = new EventBus();
    let heard = 0;
    bus.on("vault-open", () => {
      throw new Error("no");
    });
    bus.on("vault-open", () => heard++);

    bus.emit("vault-open", { path: "/vault" });

    expect(heard).toBe(1);
  });

  test("starts a source with the first listener and stops it with the last", () => {
    const bus = new EventBus();
    const log: string[] = [];
    bus.whileListened("vault-change", { start: () => log.push("start"), stop: () => log.push("stop") });

    const a = bus.on("vault-change", () => {});
    const b = bus.on("vault-change", () => {});
    a.dispose();
    expect(log).toEqual(["start"]);
    b.dispose();
    expect(log).toEqual(["start", "stop"]);
    expect(bus.listening("vault-change")).toBe(false);
  });

  test("starts a source at once if someone was already listening", () => {
    const bus = new EventBus();
    bus.on("vault-change", () => {});
    let started = false;
    bus.whileListened("vault-change", { start: () => (started = true), stop() {} });
    expect(started).toBe(true);
  });
});
