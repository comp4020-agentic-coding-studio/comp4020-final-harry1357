// A client for the raid's public contract — HTTP for joining and acting, a
// WebSocket for watching — written from the outside. The shapes below are what
// the spec relies on, not the app's own types, so the tests hold whatever the
// app is built with.

export interface Token {
  id: string;
  kind: "character" | "boss";
  name: string;
  role: string;
  counter: number;
  hp: number;
  maxHp: number;
}

export interface BattleState {
  battleId: string;
  /** Bumped on every broadcast, so two watchers can compare like for like. */
  version: number;
  tick: number;
  status: string;
  activeId: string | null;
  /** In turn order, as the server decided it. */
  queue: Token[];
}

export interface Character {
  id: string;
  name: string;
  role: string;
}

export const suffix = (): string => crypto.randomUUID().slice(0, 8);

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function body(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function newBattle(base: string): Promise<string> {
  const res = await fetch(new URL("/api/battles", base), { method: "POST" });
  if (res.status !== 201) throw new Error(`POST /api/battles answered ${res.status}, expected 201`);
  const { battleId } = await body(res);
  if (typeof battleId !== "string") throw new Error("POST /api/battles sent no battleId");
  return battleId;
}

export interface Joined {
  status: number;
  /** The session cookie to send back, as `name=value` pairs. */
  cookie: string;
  characterId: string | null;
}

/** Join as a person: a cookie (minted by the server unless one is passed), a name and a role. */
export async function join(base: string, battleId: string, name: string, role: string, cookie = ""): Promise<Joined> {
  const res = await fetch(new URL(`/api/battles/${battleId}/join`, base), {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ name, role }),
  });
  const minted = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const { characterId } = await body(res);
  return {
    status: res.status,
    cookie: minted || cookie,
    characterId: typeof characterId === "string" ? characterId : null,
  };
}

export async function act(
  base: string,
  battleId: string,
  cookie: string,
  action: string,
  targetId?: string,
): Promise<{ status: number; tick: number | null; error: string | null }> {
  const res = await fetch(new URL(`/api/battles/${battleId}/actions`, base), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(targetId ? { action, targetId } : { action }),
  });
  const { tick, error } = await body(res);
  return {
    status: res.status,
    tick: typeof tick === "number" ? tick : null,
    error: typeof error === "string" ? error : null,
  };
}

export async function battle(base: string, battleId: string): Promise<BattleState> {
  const res = await fetch(new URL(`/api/battles/${battleId}`, base));
  if (res.status !== 200) throw new Error(`GET /api/battles/${battleId} answered ${res.status}`);
  return (await res.json()) as BattleState;
}

export async function battleLog(
  base: string,
  battleId: string,
): Promise<{ status: string; entries: unknown[] }> {
  const res = await fetch(new URL(`/api/battles/${battleId}/log`, base));
  if (res.status !== 200) throw new Error(`GET /api/battles/${battleId}/log answered ${res.status}`);
  return (await res.json()) as { status: string; entries: unknown[] };
}

export async function me(base: string, cookie: string): Promise<{ character: Character | null }> {
  const res = await fetch(new URL("/api/me", base), { headers: { cookie } });
  if (res.status !== 200) throw new Error(`GET /api/me answered ${res.status}`);
  return (await res.json()) as { character: Character | null };
}

export const token = (state: BattleState, id: string | null): Token | undefined =>
  state.queue.find((t) => t.id === id);

export const boss = (state: BattleState): Token | undefined => state.queue.find((t) => t.kind === "boss");

export interface Watcher {
  /** Every state this socket has received, in arrival order. */
  states: BattleState[];
  opened: Promise<void>;
  /** The first state from index `from` on that satisfies `test`. */
  waitFor(test: (state: BattleState) => boolean, what: string, timeoutMs: number, from?: number): Promise<BattleState>;
  close(): void;
}

/** Subscribe to a battle's broadcast, as any browser at the table would. */
export function watch(base: string, battleId: string): Watcher {
  const url = new URL(`/ws?battle=${encodeURIComponent(battleId)}`, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);
  const states: BattleState[] = [];
  const listeners = new Set<() => void>();

  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error(`no WebSocket at ${url}`)), { once: true });
  });

  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data)) as { type?: string; battle?: BattleState };
    if (msg.type === "state" && msg.battle) {
      states.push(msg.battle);
      for (const listener of listeners) listener();
    }
  });

  function waitFor(test: (state: BattleState) => boolean, what: string, timeoutMs: number, from = 0) {
    return new Promise<BattleState>((resolve, reject) => {
      const check = (): boolean => {
        const found = states.slice(from).find(test);
        if (!found) return false;
        listeners.delete(listener);
        clearTimeout(timer);
        resolve(found);
        return true;
      };
      const listener = (): void => void check();
      const timer = setTimeout(() => {
        listeners.delete(listener);
        reject(new Error(`waited ${timeoutMs}ms for ${what}; saw ${states.length - from} state(s)`));
      }, timeoutMs);
      listeners.add(listener);
      check();
    });
  }

  return { states, opened, waitFor, close: () => socket.close() };
}
