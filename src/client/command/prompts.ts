// What the strip asks of a command now, in words, for the command window's
// note (SeatInfo.prompts): a Warden's Bastion, while a Perihelion is coming and
// none stands. Read from the state, the blow a Bastion would meet first the
// server's to say (bastionCard; review R2). Its own module so a test can hold it
// (third review, M5).
import type { ActionId, BattleState, Token } from "../../shared/protocol.ts";
import { bastionFor } from "../strip/cards.ts";

export function prompts(state: BattleState, token: Token | null): Partial<Record<ActionId, string>> {
  const asked = bastionFor(state, token ?? undefined);
  if (!asked) return {};
  const when = asked.card.countdown <= 0 ? "next" : `in ${asked.card.countdown}`;
  const first = asked.first;
  const before = first ? ` The ${first.intent.charAt(0).toUpperCase()}${first.intent.slice(1)}, ${first.countdown <= 0 ? "next" : `in ${first.countdown}`}, would take one raised now.` : "";
  return { bastion: `Perihelion ${when}: a Bastion blunts it.${before}` };
}
