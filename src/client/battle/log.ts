// The log window: the narration, written only after the screen has shown it
// (the conductor decides when). Each line carries its seq, so a line can be
// found by the event that wrote it, and its fight: every fight numbers its
// lines from 1, and a room's next fight follows its last in this window, so a
// line is known by its fight and its number together (phase two's re-review, N1).
import type { LogEntry } from "../../shared/protocol.ts";

const KEEP = 40;

export interface LogWindow {
  /** Replace everything with the log as it stands (first message, or after a reconnect), for this fight. */
  history(entries: readonly LogEntry[], fight?: string): void;
  /** One more line of this fight, now that its event has been shown. */
  append(entry: LogEntry, fight?: string): void;
}

export function createLog(list: HTMLElement): LogWindow {
  /** Lines written, as fight and number. */
  const seen = new Set<string>();
  const key = (entry: LogEntry, fight: string): string => `${fight}#${entry.seq}`;

  function line(entry: LogEntry, fight: string): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "log-line";
    li.dataset.seq = String(entry.seq);
    li.dataset.fight = fight;
    li.dataset.kind = entry.kind;
    const text = document.createElement("span");
    text.className = "log-text";
    text.textContent = entry.text;
    li.append(text);
    return li;
  }

  function trim(): void {
    while (list.children.length > KEEP) list.firstElementChild?.remove();
  }

  return {
    history(entries, fight = "") {
      seen.clear();
      list.replaceChildren(...entries.map((e) => (seen.add(key(e, fight)), line(e, fight))));
      trim();
      list.scrollTop = list.scrollHeight;
    },
    append(entry, fight = "") {
      if (seen.has(key(entry, fight))) return;
      seen.add(key(entry, fight));
      list.append(line(entry, fight));
      trim();
      list.scrollTop = list.scrollHeight;
    },
  };
}
