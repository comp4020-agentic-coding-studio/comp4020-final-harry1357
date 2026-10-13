// The log window: the narration, written only after the screen has shown it
// (the conductor decides when). Each line carries its seq, so a line can be
// found by the event that wrote it.
import type { LogEntry } from "../../shared/protocol.ts";

const KEEP = 40;

export interface LogWindow {
  /** Replace everything with the log as it stands (first message, or after a reconnect). */
  history(entries: readonly LogEntry[]): void;
  /** One more line, now that its event has been shown. */
  append(entry: LogEntry): void;
}

export function createLog(list: HTMLElement): LogWindow {
  const seen = new Set<number>();

  function line(entry: LogEntry): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "log-line";
    li.dataset.seq = String(entry.seq);
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
    history(entries) {
      seen.clear();
      list.replaceChildren(...entries.map((e) => (seen.add(e.seq), line(e))));
      trim();
      list.scrollTop = list.scrollHeight;
    },
    append(entry) {
      if (seen.has(entry.seq)) return;
      seen.add(entry.seq);
      list.append(line(entry));
      trim();
      list.scrollTop = list.scrollHeight;
    },
  };
}
