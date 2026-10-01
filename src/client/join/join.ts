// SCAFFOLD STUB, owned by the join-screen area, which replaces this file. It
// must keep the hooks other sensors drive: form[data-join], input[name="name"],
// radios input[name="role"][value=<roleId>], button[type="submit"].
import type { MeResponse } from "../../shared/protocol.ts";
import type { Join, JoinOptions } from "../battle/api.ts";

export function mountJoin(root: HTMLElement, _opts: JoinOptions): Join {
  return {
    show(_me: MeResponse | null) {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    ended() {
      root.hidden = false;
    },
  };
}
