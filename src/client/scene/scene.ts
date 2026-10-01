// SCAFFOLD STUB, owned by the scene area, which replaces this file: the field,
// the party sprites, the Orrery, numbers and every motion primitive. Inert so
// the page boots.
import type { BattleState } from "../../shared/protocol.ts";
import type { PartsOptions, Scene } from "../battle/api.ts";

export function createScene(root: HTMLElement, _opts: PartsOptions): Scene {
  const done = async (): Promise<void> => {};
  return {
    reconcile(_state: BattleState, _myId: string | null) {
      root.dataset.stub = "scene";
    },
    frame: done,
    hp() {},
    number() {},
    hit() {},
    guard() {},
    haste() {},
    down() {},
    arrive() {},
    depart() {},
    rings() {},
    target() {},
    banner() {},
    shake: done,
    pushIn: done,
    projectile: done,
    slash: done,
    pulse: done,
    spinUp: done,
    afterimage: done,
  };
}
