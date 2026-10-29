import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { boot, cleanScratch, scratchDatabase } from "./boot.ts";
import { sleep } from "./raid.ts";

// A page load asks for /favicon.ico whatever the page says, and the not-found
// route logged it as a refused read (src/server/app.ts; RICE item 4): one
// refusal line per visitor that refused nothing, in the log docs/narration.md
// reads. The page names its icon, the icon is served, and a page load's
// requests write no refusal line. The icon is the Orrery's ring, original
// work, and credited under rule 12 (spec/assets.test.ts holds its row).

afterAll(cleanScratch);

describe("a page load writes no refusal line", () => {
  it("the page links an icon, the browser's /favicon.ico is served, and neither is refused", async () => {
    const page = readFileSync("src/client/index.html", "utf8");
    const href = /<link rel="icon"[^>]*href="([^"]+)"/.exec(page)?.[1];
    expect(href, "index.html links an icon").toBeTruthy();

    const server = await boot(scratchDatabase());
    try {
      for (const path of ["/", href as string, "/favicon.ico", "/assets/styles.css", "/assets/app.js"]) {
        const res = await fetch(new URL(path, server.base));
        expect(res.status, `${path} answers`).toBe(200);
        if (path === href || path === "/favicon.ico") expect(res.headers.get("content-type"), `${path} is an image`).toMatch(/^image\//);
        await res.arrayBuffer();
      }
      await sleep(200);
      const refused = server.stdout().filter((l) => /\boutcome=refused\b/.test(l));
      expect(refused, "a page load's requests, refused").toEqual([]);
    } finally {
      await server.kill();
    }
  });
});
