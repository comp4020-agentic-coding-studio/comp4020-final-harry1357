// Talking to the one server: JSON over HTTP for asking and acting, a socket for
// watching. Nothing here retries an action. A refusal comes back as a status
// for the caller to show, and that is the end of it.
import { ROOM_CLOSED_CODE, type RoomInfo, type RoomSocketMessage, type ServerMessage } from "../shared/protocol.ts";

export interface Answer<T> {
  status: number;
  ok: boolean;
  /** The parsed body on a 2xx, otherwise null. */
  data: T | null;
  /** The server's `{error}` text on a non-2xx, or a stand-in when it sent none. */
  error: string | null;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<Answer<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { status: 0, ok: false, data: null, error: "The table can't be reached. Check your connection." };
  }
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (res.ok) return { status: res.status, ok: true, data: parsed as T, error: null };
  const error =
    parsed && typeof parsed === "object" && typeof (parsed as { error?: unknown }).error === "string"
      ? (parsed as { error: string }).error
      : null;
  return { status: res.status, ok: false, data: null, error };
}

export const getJSON = <T>(path: string): Promise<Answer<T>> => call<T>("GET", path);
export const postJSON = <T>(path: string, body: unknown): Promise<Answer<T>> => call<T>("POST", path, body);

export type Link = "connecting" | "live" | "reconnecting";

export interface Watch {
  /** Stop watching for good (the battle is over, or the page is leaving). */
  stop(): void;
}

/**
 * Watch one battle over the socket. The server sends full state on open and
 * after every change, with the events that caused it, so a reconnect needs no
 * catching up: the first message on a new socket *is* the truth. Within one socket, messages arrive in order, and
 * anything not newer than what was already handed on is dropped. Messages from
 * a socket that has been replaced are ignored outright.
 */
export function watchBattle(
  battleId: string,
  onMessage: (msg: ServerMessage) => void,
  onLink: (link: Link) => void,
  onLost: () => void,
): Watch {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${scheme}//${location.host}/ws?battle=${encodeURIComponent(battleId)}`;
  let socket: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const open = (): void => {
    if (stopped) return;
    onLink(attempt === 0 ? "connecting" : "reconnecting");
    const current = new WebSocket(url);
    socket = current;
    // The newest version seen on *this* socket. A fresh socket starts with no
    // baseline, because after a server restart versions begin again.
    let newest = Number.NEGATIVE_INFINITY;

    current.addEventListener("open", () => {
      if (socket !== current) return;
      attempt = 0;
      onLink("live");
    });
    current.addEventListener("message", (event) => {
      if (socket !== current) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type !== "state" || !msg.battle || msg.battle.battleId !== battleId) return;
      if (msg.battle.version <= newest) return;
      newest = msg.battle.version;
      onMessage({ type: "state", battle: msg.battle, events: Array.isArray(msg.events) ? msg.events : [] });
    });
    current.addEventListener("close", () => {
      if (socket !== current || stopped) return;
      socket = null;
      attempt += 1;
      onLink("reconnecting");
      onLost();
      // 0.5s, 1s, 2s, 4s … capped at 15s, with a little jitter so a room full
      // of browsers doesn't knock on the door at the same instant.
      const delay = Math.min(15_000, 500 * 2 ** (attempt - 1)) * (0.8 + Math.random() * 0.4);
      timer = setTimeout(open, delay);
    });
  };

  open();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
      socket = null;
    },
  };
}

/** Why a room's socket was let go for good: the room expired (4410), or there was never such a room (4404). */
export type RoomGone = "expired" | "missing";

/**
 * Watch a room by its code (rule 24; docs/adr/007): the server sends the room
 * (its code and its fight now), then the fight's state, and the room again
 * whenever its fight changes; every state after that is the new fight's. The
 * same order and reconnect rules as watchBattle, with two endings no reconnect
 * can mend: close code 4410, the room has expired, and 4404, no such room.
 * Both are said, never retried.
 */
export function watchRoom(
  code: string,
  onMessage: (msg: ServerMessage) => void,
  onRoom: (room: RoomInfo) => void,
  onLink: (link: Link) => void,
  onGone: (why: RoomGone) => void,
): Watch {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${scheme}//${location.host}/ws?room=${encodeURIComponent(code)}`;
  let socket: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const open = (): void => {
    if (stopped) return;
    onLink(attempt === 0 ? "connecting" : "reconnecting");
    const current = new WebSocket(url);
    socket = current;
    // The fight this socket is following, and the newest version seen of it.
    let battleId: string | null = null;
    let newest = Number.NEGATIVE_INFINITY;

    current.addEventListener("open", () => {
      if (socket !== current) return;
      attempt = 0;
      onLink("live");
    });
    current.addEventListener("message", (event) => {
      if (socket !== current) return;
      let msg: RoomSocketMessage;
      try {
        msg = JSON.parse(String(event.data)) as RoomSocketMessage;
      } catch {
        return;
      }
      if (msg.type === "room") {
        if (!msg.room || typeof msg.room.battleId !== "string") return;
        if (msg.room.battleId !== battleId) {
          battleId = msg.room.battleId;
          newest = Number.NEGATIVE_INFINITY;
        }
        onRoom(msg.room);
        return;
      }
      if (msg.type !== "state" || !msg.battle || msg.battle.battleId !== battleId) return;
      if (msg.battle.version <= newest) return;
      newest = msg.battle.version;
      onMessage({ type: "state", battle: msg.battle, events: Array.isArray(msg.events) ? msg.events : [] });
    });
    current.addEventListener("close", (event) => {
      if (socket !== current || stopped) return;
      socket = null;
      if (event.code === ROOM_CLOSED_CODE || event.code === 4404) {
        stopped = true;
        onGone(event.code === ROOM_CLOSED_CODE ? "expired" : "missing");
        return;
      }
      attempt += 1;
      onLink("reconnecting");
      const delay = Math.min(15_000, 500 * 2 ** (attempt - 1)) * (0.8 + Math.random() * 0.4);
      timer = setTimeout(open, delay);
    });
  };

  open();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
      socket = null;
    },
  };
}
