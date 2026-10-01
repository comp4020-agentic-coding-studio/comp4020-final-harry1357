// SCAFFOLD STUB, owned by the command-window area, which replaces this file.
// spec/command.test.ts states the contract.
import type { ActionId } from "../../shared/protocol.ts";

export interface CommandWindow {
  setEnabled(on: boolean): void;
  /** Time left on your turn as a fraction 1 → 0, or null when it isn't your turn. */
  setCountdown(fraction: number | null): void;
  destroy(): void;
}

export interface CommandOptions {
  actions: readonly ActionId[];
  allies: () => { id: string; name: string }[];
  onTarget: (targetId: string | null) => void;
  onChoose: (action: ActionId, targetId: string | null) => void;
}

export function mountCommandWindow(root: HTMLElement, _opts: CommandOptions): CommandWindow {
  root.dataset.stub = "command";
  return { setEnabled() {}, setCountdown() {}, destroy() {} };
}
