// The battle log, read as narration. Lines are keyed by `seq`, so a broadcast
// only adds what is new: the role="log" region announces additions, and an
// unchanged line is never re-written (and never re-announced).
import type { LogEntry } from "../shared/protocol.ts";

export function renderLog(list: HTMLElement, entries: readonly LogEntry[]): void {
  const keep = new Set(entries.map((e) => String(e.seq)));
  for (const li of Array.from(list.children) as HTMLElement[]) {
    if (!keep.has(li.dataset.seq ?? "")) li.remove();
  }
  const have = new Set((Array.from(list.children) as HTMLElement[]).map((li) => li.dataset.seq));
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;

  let added = false;
  for (const entry of entries) {
    const key = String(entry.seq);
    if (have.has(key)) continue;
    const li = document.createElement("li");
    li.className = "log-line";
    li.dataset.seq = key;
    li.dataset.kind = entry.kind;
    const tick = document.createElement("span");
    tick.className = "log-tick";
    const word = document.createElement("span");
    word.className = "visually-hidden";
    word.textContent = "Tick ";
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = String(entry.tick);
    tick.append(word, num);
    const text = document.createElement("span");
    text.className = "log-text";
    text.textContent = entry.text;
    li.append(tick, text);
    // Entries arrive oldest first; a new one belongs after every line it follows.
    const after = (Array.from(list.children) as HTMLElement[]).find((el) => Number(el.dataset.seq) > entry.seq);
    list.insertBefore(li, after ?? null);
    added = true;
  }
  if (added && nearBottom) list.scrollTop = list.scrollHeight;
  // A Tab stop only once there is something to scroll with the keyboard.
  const scrolls = list.scrollHeight > list.clientHeight + 1;
  if (scrolls) list.setAttribute("tabindex", "0");
  else list.removeAttribute("tabindex");
}
