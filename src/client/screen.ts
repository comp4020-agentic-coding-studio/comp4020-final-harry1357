// Which screen is up, decided in one place (docs/adr/009; CLAUDE.md rules
// 27 and 11): the join screen, a private room's lobby, the fight, or the end
// panel. It decides nothing about the fight: whether this page is seated,
// whether the fight is a lobby and who is host all come from the state the
// server sent. What it owns is that a new room or a new fight is a clean
// screen: the last fight's end panel and banner are cleared once, on the first
// state of whatever this page entered (the second finding: "creating a room
// dropped the creator straight into a fight … with the previous fight's
// victory text still on screen"), and that the join screen never covers a
// fight this page is seated in.
//
// The end panel stays up only while this page has nowhere to be: the fight it
// was in has ended and it isn't seated in the room's next one (a room closing
// under it keeps the ending it shows: phase two's Q2). Seated in the room's
// next lobby, the lobby carries the last fight's outcome instead.

export type Shown = "join" | "lobby" | "fight" | "ended";
type Outcome = "won" | "lost" | "abandoned";

/** As much of the state as the screen reads. */
export interface ScreenState {
  battleId: string;
  status: string;
  lobby?: boolean;
  queue: { id: string; kind: string }[];
  fallen?: { id: string; kind: string; hp?: number }[];
}

export interface ScreenParts {
  /** #battle: its data-phase says which screen is up, for the CSS. */
  root: HTMLElement;
  /** The scene's banner (scene.banner): the last fight's outcome line, cleared on a clean screen. */
  banner(text: string | null): void;
  join: { show(): void; hide(): void; ended(outcome: Outcome): void; clear(): void };
  lobby: { show(state: ScreenState): void; hide(): void };
}

export interface Screen {
  /** Every state as it arrives, with who this page is. */
  state(state: ScreenState, myId: string | null): void;
  /** This page is now watching another room, or the room's next fight: the next state gets a clean screen. */
  entered(): void;
  /** The person went on from the end panel (its link): the join screen, for the room's fight as it is. */
  goOn(): void;
  /** What is up now. */
  phase(): Shown;
  /** The outcome of the fight this page last saw end, for the lobby's "last fight" line; null once cleared by a new room. */
  lastOutcome(): Outcome | null;
}

const OVER = new Set(["won", "lost", "abandoned"]);

export function createScreen(parts: ScreenParts): Screen {
  let shown: Shown = "join";
  /** The battle whose ending is on the end panel, so a later state of it doesn't redraw it. */
  let endedId: string | null = null;
  let outcome: Outcome | null = null;
  /** A clean screen is owed: the next state is a new room's or a new fight's. */
  let fresh = true;
  /** The join screen is up for this fight; shown once, never again over it. */
  let joinFor: string | null = null;
  /** The person went on from the end panel: the join screen for the room's next fight. */
  let wentOn = false;
  /** Fights this page has seen running. */
  const ran = new Set<string>();

  function set(next: Shown): void {
    shown = next;
    parts.root.dataset.phase = next;
  }

  function clean(): void {
    parts.join.clear();
    parts.banner(null);
  }

  return {
    state(state, myId) {
      // Seated: on the strip, or downed in this fight and so still at the table (Restore brings them back, and
      // the server refuses them another seat in it; the lobby gate's P1). Someone who left isn't.
      const seated =
        myId !== null &&
        (state.queue.some((t) => t.id === myId && t.kind === "character") ||
          (state.fallen ?? []).some((t) => t.id === myId && t.kind === "character" && (t.hp ?? 0) <= 0));
      const over = OVER.has(state.status);

      if (over) {
        // A fight that ended without this page seeing it run (a room's empty lobby closed as the room
        // expired, under an end panel already up) is no ending to show: the panel keeps the one that
        // was played (phase two's Q2).
        if (shown === "ended" && endedId !== state.battleId && !ran.has(state.battleId)) return;
        if (endedId !== state.battleId) {
          // A fight this page watched has ended: its panel, once. The banner is the end renderer's.
          endedId = state.battleId;
          outcome = state.status as Outcome;
          fresh = false;
          joinFor = null;
          wentOn = false;
          parts.lobby.hide();
          parts.join.ended(outcome);
        }
        set("ended");
        return;
      }

      if (state.status === "fighting") ran.add(state.battleId);

      if (fresh) {
        // The first state of a room or fight this page has entered: nothing of the last one stays up. Unless this
        // page isn't seated in it and an ending is up: then it has nowhere to be, and the panel stays until the
        // person goes on (the lobby gate's P2).
        fresh = false;
        if (seated || shown !== "ended" || wentOn) clean();
      }

      if (seated) {
        if (shown === "ended") clean();
        if (state.lobby) parts.lobby.show(state);
        else parts.lobby.hide();
        if (joinFor !== null || shown === "ended" || wentOn) parts.join.hide();
        joinFor = null;
        wentOn = false;
        set(state.lobby ? "lobby" : "fight");
        return;
      }

      // Not seated. Fresh from an ending, the panel stays until the person goes on.
      if (shown === "ended" && !wentOn) return;
      parts.lobby.hide();
      if (joinFor !== state.battleId) {
        joinFor = state.battleId;
        parts.join.show();
      }
      set("join");
    },

    entered() {
      fresh = true;
    },

    goOn() {
      wentOn = true;
      joinFor = null;
      outcome = null;
      parts.join.clear();
    },

    phase: () => shown,
    lastOutcome: () => outcome,
  };
}
