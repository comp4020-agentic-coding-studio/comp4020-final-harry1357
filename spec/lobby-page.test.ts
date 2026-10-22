import { afterAll, beforeAll, expect, it } from "vitest";
import { boot, cleanScratch, scratchDatabase, type Booted } from "./boot.ts";
import { launchChrome, type Chrome } from "./browser.ts";

// The lobby gate's breaker B1 (rule 27, ADR-009: a lobby seat has left when
// it has had "no socket open on the room for LOBBY_GRACE_MS"), held in real
// Chrome, because only a page shows it: a first-time visitor opens a room's
// link, its socket opens before any cookie exists, and the person sits down
// through the form. The server tells who is present by the cookie a socket
// opened with, so that socket was nobody's and the guest was unseated from the
// lobby with the page open on it.

let server: Booted;
let host: Chrome;
let guest: Chrome;

beforeAll(async () => {
  server = await boot(scratchDatabase(), { TICK_MS: "50", LOBBY_GRACE_MS: "1500" });
  // Two browsers, so two sessions: the guest's has no cookie at all when it opens the link.
  [host, guest] = await Promise.all([launchChrome(), launchChrome()]);
}, 30_000);

afterAll(async () => {
  await Promise.all([host?.close(), guest?.close()]);
  await server?.kill();
  cleanScratch();
});

it("B1: a guest who sits down from a room's link stays seated while the page is open", async () => {
  const res = await fetch(new URL("/api/rooms", server.base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Hosting Hal", role: "warden" }),
  });
  const made = (await res.json()) as { code: string; characterId: string };
  // The host's own page holds a socket on the room, so the host stays.
  const hostCookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const ht = await host.open("about:blank");
  await ht.send("Network.enable");
  await ht.send("Network.setExtraHTTPHeaders", { headers: { cookie: hostCookie } });
  await ht.send("Page.navigate", { url: `${server.base}/?room=${made.code}` });
  await ht.until(`document.querySelector("#battle").dataset.phase === "lobby"`, "the host's page in the lobby", 15_000);

  const tab = await guest.open("about:blank");
  await tab.send("Page.navigate", { url: `${server.base}/?room=${made.code}` });
  await tab.until(`!!document.querySelector("form[data-join]") && !document.querySelector("form[data-join]").hidden`, "the join form", 15_000);
  await tab.evaluate(`(() => { const f = document.querySelector("form[data-join]");
    const n = f.querySelector('input[name="name"]'); n.value = "Guest Gwen"; n.dispatchEvent(new Event("input", { bubbles: true }));
    f.querySelector('input[name="role"][value="striker"]').click(); f.requestSubmit(); })()`);
  await tab.until(`document.querySelector("#battle").dataset.phase === "lobby"`, "the guest in the lobby", 15_000);
  const me = await tab.evaluate<string>(`document.body.dataset.me`);

  // Past the grace, twice over, with the page open the whole time.
  await tab.evaluate(`new Promise((r) => setTimeout(r, 3500))`);
  const st = (await (await fetch(new URL(`/api/rooms/${made.code}`, server.base))).json()) as { battleId: string };
  const ws = new WebSocket(new URL(`/ws?room=${made.code}`, server.base.replace("http", "ws")));
  const seats = await new Promise<string[]>((resolve) =>
    ws.addEventListener("message", (m) => {
      const d = JSON.parse(String(m.data)) as { type: string; battle?: { battleId: string; queue: { id: string }[] } };
      if (d.type === "state" && d.battle?.battleId === st.battleId) {
        ws.close();
        resolve(d.battle.queue.map((t) => t.id));
      }
    }),
  );
  expect(seats, "the guest is still seated in the lobby").toContain(me);
  expect(await tab.evaluate<string>(`document.querySelector("#battle").dataset.phase`), "and the page still shows the lobby").toBe("lobby");
}, 60_000);
