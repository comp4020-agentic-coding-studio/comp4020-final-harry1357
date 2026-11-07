import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Headless Chromes a cut-off run left behind (the owner's ruling on the difficulty gate's harness). Every
// Chrome the specs and the sensors start carries MARK=<the starting process's pid>: Chrome ignores a switch it
// doesn't know, but `ps` shows it. A run killed by a signal, or a machine that slept mid-roster, runs no
// cleanup at all, and its Chromes go on holding CPU, which is how three of them turned the next roster's
// timing specs red (docs/review/difficulty.md). `pnpm check` runs this first.
//
//   node scripts/stray-chromes.ts
//
// It kills only a marked Chrome whose starting process is gone. One whose run is still going is another
// check on this machine, and is left alone.

/** The switch every Chrome this repo starts carries, with its starter's pid: `--raid-spec-chrome=<pid>`. */
export const MARK = "--raid-spec-chrome";

/** The switch for a Chrome this process is about to start. */
export const markArg = (): string => `${MARK}=${process.pid}`;

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists, and isn't ours to signal.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Kill the marked Chromes whose run is gone; returns how many. */
export function killStrays(): number {
  let listing = "";
  try {
    listing = execFileSync("ps", ["-Ao", "pid=,command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return 0; // no ps (a bare container): nothing to sweep
  }
  let killed = 0;
  for (const line of listing.split("\n")) {
    const m = new RegExp(`^\\s*(\\d+)\\s+.*${MARK}=(\\d+)`).exec(line);
    if (!m) continue;
    const [pid, owner] = [Number(m[1]), Number(m[2])];
    if (owner === process.pid || alive(owner)) continue;
    try {
      process.kill(pid, "SIGKILL");
      killed++;
    } catch {
      // gone already
    }
  }
  return killed;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const n = killStrays();
  console.log(n ? `stopped ${n} headless Chrome(s) a cut-off run left behind` : "no stray headless Chromes");
}
