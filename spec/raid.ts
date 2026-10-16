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
  /** The server plays this seat (rules 8 and 25). */
  echo?: boolean;
  /** An Echo seated on purpose: who seated it. Null for a person's seat (rule 25). */
  seatedBy?: string | null;
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
  /** Seats counted when the Orrery's HP was set at the pull (rule 20). */
  pullSeats?: number;
}

export interface Character {
  id: string;
  name: string;
  role: string;
  turns?: number;
}

/** A room as the server describes it (rules 22-23). */
export interface Room {
  code: string;
  isPublic: boolean;
  /** The room's fight now. */
  battleId: string;
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

// --- rooms and Echoes (docs/adr/007) -----------------------------------------

/** The default door: the public raid's code and its fight now. */
export async function raid(base: string): Promise<{ code: string | null; battleId: string | null }> {
  const res = await fetch(new URL("/api/raid", base));
  if (res.status !== 200) throw new Error(`GET /api/raid answered ${res.status}`);
  const { code, battleId } = await body(res);
  return { code: typeof code === "string" ? code : null, battleId: typeof battleId === "string" ? battleId : null };
}

/** Ask for a room, as whoever the cookie says. */
export async function createRoom(
  base: string,
  cookie: string,
): Promise<{ status: number; code: string | null; battleId: string | null }> {
  const res = await fetch(new URL("/api/rooms", base), { method: "POST", headers: cookie ? { cookie } : {} });
  const { code, battleId } = await body(res);
  return {
    status: res.status,
    code: typeof code === "string" ? code : null,
    battleId: typeof battleId === "string" ? battleId : null,
  };
}

export async function room(base: string, code: string): Promise<{ status: number; room: Room | null }> {
  const res = await fetch(new URL(`/api/rooms/${encodeURIComponent(code)}`, base));
  const found = await body(res);
  return { status: res.status, room: res.status === 200 ? (found as unknown as Room) : null };
}

/** Sit down in a room by its code: a person, a name and a role, as join() does for a battle. */
export async function joinRoom(
  base: string,
  code: string,
  name: string,
  role: string,
  cookie = "",
): Promise<Joined & { battleId: string | null }> {
  const res = await fetch(new URL(`/api/rooms/${encodeURIComponent(code)}/join`, base), {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ name, role }),
  });
  const minted = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const { characterId, battleId } = await body(res);
  return {
    status: res.status,
    cookie: minted || cookie,
    characterId: typeof characterId === "string" ? characterId : null,
    battleId: typeof battleId === "string" ? battleId : null,
  };
}

/** Seat an Echo of `role` in a room, as whoever the cookie says. */
export async function seatEcho(
  base: string,
  code: string,
  cookie: string,
  role: string,
): Promise<{ status: number; echoId: string | null; error: string | null }> {
  const res = await fetch(new URL(`/api/rooms/${encodeURIComponent(code)}/echoes`, base), {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ role }),
  });
  const { echoId, error } = await body(res);
  return {
    status: res.status,
    echoId: typeof echoId === "string" ? echoId : null,
    error: typeof error === "string" ? error : null,
  };
}

export const token = (state: BattleState, id: string | null): Token | undefined =>
  state.queue.find((t) => t.id === id);

export const boss = (state: BattleState): Token | undefined => state.queue.find((t) => t.kind === "boss");

/** One thing that happened, as the server broadcast it alongside the state. */
export interface Event {
  kind: string;
  seq?: number;
  actorId?: string | null;
  [field: string]: unknown;
}

export interface Watcher {
  /** Every state this socket has received, in arrival order. */
  states: BattleState[];
  /** Every event this socket has received, in arrival order. */
  events: Event[];
  /** Every state message as it arrived: the state, and the events that made it. */
  messages: { state: BattleState; events: Event[] }[];
  /** Every room message this socket has received (a room's watchers only). */
  rooms: Room[];
  opened: Promise<void>;
  /** The first state from index `from` on that satisfies `test`. */
  waitFor(test: (state: BattleState) => boolean, what: string, timeoutMs: number, from?: number): Promise<BattleState>;
  close(): void;
}

/** Subscribe to a battle's broadcast, as any browser at the table would. */
export function watch(base: string, battleId: string): Watcher {
  return subscribe(base, `/ws?battle=${encodeURIComponent(battleId)}`);
}

/** Subscribe to a room by its code: its fight now, and each fight after (rule 24). */
export function watchRoom(base: string, code: string): Watcher {
  return subscribe(base, `/ws?room=${encodeURIComponent(code)}`);
}

function subscribe(base: string, path: string): Watcher {
  const url = new URL(path, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);
  const states: BattleState[] = [];
  const events: Event[] = [];
  const messages: { state: BattleState; events: Event[] }[] = [];
  const rooms: Room[] = [];
  const listeners = new Set<() => void>();

  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error(`no WebSocket at ${url}`)), { once: true });
  });

  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data)) as { type?: string; battle?: BattleState; events?: Event[]; room?: Room };
    if (msg.type === "state" && msg.battle) {
      const raised = Array.isArray(msg.events) ? msg.events : [];
      events.push(...raised);
      states.push(msg.battle);
      messages.push({ state: msg.battle, events: raised });
      for (const listener of listeners) listener();
    } else if (msg.type === "room" && msg.room) {
      rooms.push(msg.room);
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

  return { states, events, messages, rooms, opened, waitFor, close: () => socket.close() };
}
