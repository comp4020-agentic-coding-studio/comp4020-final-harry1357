// The front door (CLAUDE.md rule 23): which room this page opens. A code in
// the address (?room=CODE) is that room. With none, the server's default door,
// GET /api/raid, names the public raid's room, and its answer is used exactly
// as given: the client never hard-codes the public raid's code (review R9,
// re-review N7). The client decides nothing here but how to read an address.

/**
 * A code as the server reads it: ASCII letters in either case, so ASCII case
 * is folded and nothing else is touched (phase two's gate, B2: JavaScript's
 * toUpperCase makes a dotless ı an I and a long ſ an S, turning a code the
 * server refuses into a real one). Nothing is trimmed either (Q7).
 */
export function foldCode(code: string): string {
  return code.replace(/[a-z]/g, (c) => c.toUpperCase());
}

/** The room code to open: the address's, or the one the server's default door names. */
export async function door(search: string, ask: (path: string) => Promise<unknown>): Promise<string> {
  const given = new URLSearchParams(search).get("room");
  // An address with no code in it (absent, empty, only spaces) goes through the default door.
  if (given && given.trim() !== "") return foldCode(given);
  for (let attempt = 0; ; attempt++) {
    let answer: unknown = null;
    try {
      answer = await ask("/api/raid");
    } catch {
      answer = null;
    }
    const code = answer && typeof answer === "object" ? (answer as { code?: unknown }).code : undefined;
    if (typeof code === "string" && code !== "") return code;
    await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, 1_000 * 2 ** attempt)));
  }
}
