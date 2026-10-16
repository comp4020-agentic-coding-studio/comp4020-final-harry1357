import { afterAll, describe, expect, it } from "vitest";
import { boot, cleanScratch, scratchDatabase } from "./boot.ts";
import { act, battle, battleLog, createRoom, join, me, newBattle, raid, room, sleep, suffix } from "./raid.ts";

// Characters and battle logs survive a restart; fights don't. A restart can't
// be done to the app the rest of spec/ runs against: that is somebody else's
// process, and in CI its /data is a tmpfs a container restart would wipe. So
// this file boots its own server from source against a temporary database,
// kills it with SIGKILL (no graceful shutdown to hide behind) and boots it
// again on the same file. See docs/adr/001.

afterAll(cleanScratch);

describe("what survives a restart", () => {
  it("a character survives a server restart", async () => {
    const db = scratchDatabase();
    const name = `keeper-${suffix()}`;

    const first = await boot(db);
    let cookie = "";
    let before;
    try {
      const joined = await join(first.base, await newBattle(first.base), name, "warden");
      expect(joined.status).toBe(200);
      expect(joined.cookie, "joining mints a session cookie").not.toBe("");
      cookie = joined.cookie;
      before = (await me(first.base, cookie)).character;
      expect(before).toMatchObject({ id: joined.characterId, name, role: "warden" });
    } finally {
      await first.kill();
    }

    const second = await boot(db);
    try {
      const after = (await me(second.base, cookie)).character;
      expect(after, "the same cookie finds the same character").toMatchObject({
        id: before?.id,
        name: before?.name,
        role: before?.role,
      });
    } finally {
      await second.kill();
    }
  }, 45_000);

  it("a completed battle's log is readable after restart", async () => {
    const db = scratchDatabase();

    // A fast clock, so a whole fight fits in a test.
    const first = await boot(db, { TICK_MS: "5" });
    let battleId = "";
    let status = "";
    let before;
    try {
      battleId = await newBattle(first.base);
      const mine = await join(first.base, battleId, `finisher-${suffix()}`, "striker");
      expect(mine.status).toBe(200);

      for (const deadline = Date.now() + 45_000; ; ) {
        const st = await battle(first.base, battleId);
        if (st.status === "won" || st.status === "lost") {
          status = st.status;
          break;
        }
        if (Date.now() > deadline) throw new Error(`the battle was still ${st.status} after 45s`);
        if (st.activeId === mine.characterId) {
          expect((await act(first.base, battleId, mine.cookie, "jab")).status, "it was my turn").toBe(200);
        } else {
          await sleep(10);
        }
      }

      before = await battleLog(first.base, battleId);
      expect(before.status).toBe(status);
      expect(before.entries.length, "a finished fight has a log").toBeGreaterThan(0);
    } finally {
      await first.kill();
    }

    const second = await boot(db);
    try {
      const after = await battleLog(second.base, battleId);
      expect(after.status, "the outcome survived").toBe(status);
      expect(after.entries, "every line written before the kill is still there").toEqual(before?.entries);
    } finally {
      await second.kill();
    }
  }, 90_000);

  it("a private room doesn't survive a restart; the public raid's code does", async () => {
    // Review R11: rule 26 says rooms live in memory and don't survive a
    // restart, and ADR-007's cost says the public raid's code doesn't change.
    // Nothing held either: a room registry kept in SQLite passed every spec.
    const db = scratchDatabase();
    const first = await boot(db);
    let code = "";
    let publicCode: string | null = null;
    try {
      const host = await join(first.base, await newBattle(first.base), `roomer-${suffix()}`, "warden");
      const made = await createRoom(first.base, host.cookie);
      expect(made.status, "a seated player makes a room").toBe(201);
      code = made.code as string;
      expect((await room(first.base, code)).status, "the room is there before the restart").toBe(200);
      publicCode = (await raid(first.base)).code;
    } finally {
      await first.kill();
    }

    const second = await boot(db);
    try {
      expect((await room(second.base, code)).status, "after a restart the private code finds nothing").toBe(404);
      expect((await raid(second.base)).code, "the public raid comes back under the same code").toBe(publicCode);
      expect((await room(second.base, publicCode as string)).status, "and answers by it").toBe(200);
    } finally {
      await second.kill();
    }
  }, 40_000);
});
