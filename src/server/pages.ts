// The files the server hands out: the client's page and bundle, README.md
// rendered at /readme/, and the README's images. Every path is resolved from
// the repo root the caller passes in, never the working directory, and every
// file is read per request so the page always matches what's on disk.

import type { Hono } from "hono";
import { marked } from "marked";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const FALLBACK_PAGE = `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Orrery</title>
</head>
<body>
<main>
<h1>The Orrery</h1>
<p>The table is still being set.</p>
</main>
</body>
</html>
`;

const ASSETS: Readonly<Record<string, readonly [file: string, type: string]>> = {
  "/assets/app.js": ["dist/client/app.js", "text/javascript; charset=utf-8"],
  "/assets/app.js.map": ["dist/client/app.js.map", "application/json; charset=utf-8"],
  "/assets/styles.css": ["src/client/styles.css", "text/css; charset=utf-8"],
};

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/** One plain file name with an image extension: no directories, no dotfiles, no traversal. */
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.([A-Za-z]+)$/;

async function readOrNull(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

function readmePage(rendered: string): string {
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>About — The Orrery</title>
<link rel="stylesheet" href="/assets/styles.css">
</head>
<body class="readme-page">
<header class="site-header"><a href="/">Back to the table</a></header>
<main class="readme">
${rendered}</main>
</body>
</html>
`;
}

export function mountPages(app: Hono, root: string): void {
  app.get("/", async (c) => {
    const page = await readOrNull(join(root, "src/client/index.html"));
    return c.html(page ? page.toString("utf8") : FALLBACK_PAGE, 200, { "Cache-Control": "no-cache" });
  });

  for (const [route, [file, type]] of Object.entries(ASSETS)) {
    app.get(route, async (c) => {
      const body = await readOrNull(join(root, file));
      if (!body) return c.json({ error: `${route} hasn't been built.` }, 404);
      return c.body(new Uint8Array(body), 200, { "Content-Type": type, "Cache-Control": "no-cache" });
    });
  }

  app.get("/readme", (c) => c.redirect("/readme/", 301));

  app.get("/readme/", async (c) => {
    const readme = await readOrNull(join(root, "README.md"));
    if (!readme) return c.json({ error: "There's no README.md to show." }, 404);
    const rendered = marked.parse(readme.toString("utf8"), { async: false });
    return c.html(readmePage(rendered), 200, { "Cache-Control": "no-cache" });
  });

  app.get("/readme/docs/:file", async (c) => {
    const name = c.req.param("file");
    const type = IMAGE_TYPES[IMAGE_NAME.exec(name)?.[1]?.toLowerCase() ?? ""];
    const body = type ? await readOrNull(join(root, "docs", name)) : null;
    if (!type || !body) return c.json({ error: "No such image." }, 404);
    return c.body(new Uint8Array(body), 200, {
      "Content-Type": type,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      // an SVG is a document: let it draw, never run
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    });
  });
}
