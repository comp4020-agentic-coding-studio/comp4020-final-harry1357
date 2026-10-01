// SCAFFOLD STUB, owned by the turn-strip area, which replaces this file.
import type { BattleState } from "../../shared/protocol.ts";
import type { PartsOptions, Strip } from "../battle/api.ts";

export function createStrip(root: HTMLElement, _opts: PartsOptions): Strip {
  return {
    render(state: BattleState, _myId: string | null) {
      root.dataset.version = String(state.version);
    },
    flag() {},
    afterimage: async () => {},
  };
}
