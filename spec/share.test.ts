// @vitest-environment jsdom
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The lobby's code can be sent, not only read out (RICE item 3). The ?room=CODE
// link already opens a room (src/client/door.ts); the lobby offers it: a phone
// with a share sheet (navigator.share) shares it, anything else copies it to
// the clipboard, and either way the page says what happened. It decides
// nothing: the code is the one the server gave the room (rule 22), and the
// button only hands its link on.

type Lobby = { show(st: unknown, me: string | null, code: string | null): void };
const mount = async (): Promise<{ root: HTMLElement; lobby: Lobby }> => {
  const { createLobby } = (await import(resolve("src/client/lobby/lobby.ts"))) as {
    createLobby: (root: HTMLElement, o: unknown) => Lobby;
  };
  const root = document.createElement("section");
  document.body.append(root);
  const lobby = createLobby(root, { onStart: async () => null, onLeave: async () => null, onEcho: async () => null, lastOutcome: () => null });
  return { root, lobby };
};
const st = {
  status: "waiting",
  hostId: "host",
  echoRoles: [],
  queue: [
    { id: "host", kind: "character", name: "Hal", role: "warden", seatedBy: null, echo: false },
    { id: "orrery", kind: "boss", name: "The Orrery", role: "orrery" },
  ],
};
const settle = () => new Promise((r) => setTimeout(r, 0));
const nav = navigator as unknown as Record<string, unknown>;

afterEach(() => {
  delete nav.share;
  delete nav.clipboard;
  document.body.replaceChildren();
});

describe("the room's link can be sent from the lobby", () => {
  it("copies the ?room= link to the clipboard where there's no share sheet, and says so", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => void copied.push(t) }, configurable: true });
    const { root, lobby } = await mount();
    lobby.show(st, "host", "QZ7MK");
    const button = root.querySelector<HTMLButtonElement>("button[data-share]");
    expect(button, "the lobby offers a button to send the room's link").toBeTruthy();
    expect(button?.textContent, "it says it copies, where it can't share").toMatch(/copy/i);
    button?.click();
    await settle();
    expect(copied, "the link that opens this room").toEqual([`${location.origin}/?room=QZ7MK`]);
    expect(root.querySelector("[aria-live]")?.textContent, "and the page says so").toMatch(/copied/i);
  });

  it("hands the link to the share sheet where there is one, on a phone", async () => {
    const shared: unknown[] = [];
    Object.defineProperty(navigator, "share", { value: async (d: unknown) => void shared.push(d), configurable: true });
    const { root, lobby } = await mount();
    lobby.show(st, "host", "QZ7MK");
    const button = root.querySelector<HTMLButtonElement>("button[data-share]");
    expect(button?.textContent, "it says it shares").toMatch(/share/i);
    button?.click();
    await settle();
    expect(shared, "the share sheet gets the room's link").toEqual([expect.objectContaining({ url: `${location.origin}/?room=QZ7MK` })]);
  });

  it("says the code is still there to read out when neither works", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => Promise.reject(new Error("denied")) }, configurable: true });
    const { root, lobby } = await mount();
    lobby.show(st, "host", "QZ7MK");
    root.querySelector<HTMLButtonElement>("button[data-share]")?.click();
    await settle();
    await settle();
    expect(root.querySelector("[aria-live]")?.textContent, "a refusal is said, never retried").toMatch(/QZ7MK/);
  });
});
