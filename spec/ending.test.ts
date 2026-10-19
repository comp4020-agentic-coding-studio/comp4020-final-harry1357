// @vitest-environment jsdom
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A room's ending, on the screen (phase two's verify: "one browser alone with
// four Echoes reaches an ending"). The server ends a room's fight and opens its
// next one in the same step (rule 24), so the room socket sends the final state
// and, at once, the room again and the next fight. On the image the ending was
// on screen for about 5 ms: the conductor started the next fight fresh and
// dropped the last one's `end` (its banner and its log line, against rule 11),
// and the join screen covered the end panel. And the end panel's link went to
// "/", out of the room and into the public raid. These hold the fix:
//   - the conductor lets the last fight's events be shown and written down
//     before it draws the next fight whole (next());
//   - the end panel stays until the person goes on, and in a room its link
//     goes on to the room's next fight (ended(outcome, next)).

globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof matchMedia;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function state(battleId: string, status: string, log: { seq: number; text: string }[] = []) {
  return {
    battleId, version: 1, tick: 1, tickMs: 150, turnMs: 12_000, plateMs: null, status, activeId: null, turnDeadline: null,
    queue: [], fallen: [], phase: 1, rings: [], cards: [], chain: { links: 0, potency: 1 }, pullSeats: 1, spentExposed: [],
    room: { code: "ABCDE", isPublic: false }, preview: null, alignmentLeft: null, echoRoles: [], bastion: false,
    log: log.map((l) => ({ ...l, tick: 1, kind: "end", actorId: null })),
  };
}

describe("a room's ending is shown before its next fight", () => {
  it("the conductor shows and writes down the last fight's ending before it draws the next fight", async () => {
    const { createConductor } = (await import(resolve("src/client/battle/conductor.ts"))) as {
      createConductor: (o: unknown) => { receive(m: unknown): void; resync(): void; next?: () => void };
    };
    const seen: string[] = [];
    const written: string[] = [];
    const histories: string[] = [];
    const noop = () => {};
    const scene = new Proxy({}, { get: () => noop });
    const strip = new Proxy({}, { get: () => noop });
    const conductor = createConductor({
      scene,
      strip,
      audio: { play: noop },
      log: { append: (l: { text: string }) => written.push(l.text), history: (ls: { text: string }[]) => histories.push(ls.map((l) => l.text).join("/")) },
      registry: { end: { full: () => sleep(150), reduced: () => sleep(150) }, join: { full: () => {}, reduced: () => {} } },
      onState: (s: { battleId: string; status: string }) => seen.push(`${s.battleId}:${s.status}`),
    });
    expect(typeof conductor.next, "the conductor is told when a room's fight changes: next()").toBe("function");

    conductor.receive({ type: "state", battle: state("A", "fighting"), events: [] });
    conductor.receive({ type: "state", battle: state("A", "won", [{ seq: 9, text: "The table wins." }]), events: [{ kind: "end", seq: 9, outcome: "won" }] });
    conductor.next?.();
    conductor.receive({ type: "state", battle: state("B", "waiting"), events: [] });

    expect(seen.at(-1), "while the ending plays, the screen is still the last fight's").toBe("A:won");
    expect(written, "and its line isn't written before it's shown").toEqual([]);
    await sleep(300);
    expect(written, "the ending was shown, then written down (rule 11)").toEqual(["The table wins."]);
    expect(seen.at(-1), "and only then is the next fight drawn").toBe("B:waiting");
    // Phase two's gate, the breaker's Q1: the next fight's empty log replaced the window, and the end line was
    // on screen for no frame at all. The last fight's lines stay, and the next fight's follow them.
    expect(histories.length, "the log window isn't replaced by the next fight's: only the first fight's history was drawn").toBe(1);
    conductor.receive({ type: "state", battle: state("B", "waiting", [{ seq: 1, text: "Someone new sits down." }]), events: [{ kind: "join", seq: 1 }] });
    await sleep(50);
    expect(written, "the next fight's lines follow the last fight's, which stay").toEqual(["The table wins.", "Someone new sits down."]);
  });

  it("in a room, the end panel's link goes on to the room's next fight; elsewhere it goes to the front door", async () => {
    const { mountJoin } = (await import(resolve("src/client/join/join.ts"))) as {
      mountJoin: (root: HTMLElement, o: unknown) => { ended(outcome: string, next?: { href: string; go(): void }): void };
    };
    const root = document.createElement("section");
    document.body.append(root);
    const join = mountJoin(root, { manifest: { facing: "left", required: [], roles: {} }, onJoin: async () => ({ ok: true }) });
    let went = 0;
    join.ended("won", { href: "/?room=ABCDE", go: () => went++ });
    const link = () => root.querySelector<HTMLAnchorElement>("[data-join-end] a");
    expect(link()?.getAttribute("href"), "a room's next fight is behind its code").toBe("/?room=ABCDE");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link()?.dispatchEvent(click);
    expect(went, "going on is the page's, not a reload into the public raid").toBe(1);
    expect(click.defaultPrevented, "so the link doesn't navigate").toBe(true);

    join.ended("abandoned");
    expect(link()?.getAttribute("href"), "with nowhere in particular to go on to, the front door").toBe("/");
    const plain = new MouseEvent("click", { bubbles: true, cancelable: true });
    link()?.dispatchEvent(plain);
    expect(went, "and the room's handler is gone").toBe(1);
    expect(plain.defaultPrevented, "the link navigates as a link").toBe(false);
  });
});
