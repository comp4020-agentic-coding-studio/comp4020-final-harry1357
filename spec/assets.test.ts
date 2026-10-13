import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, inject, it } from "vitest";
import { contentBox, crop, decodePng, type Image } from "../scripts/png.ts";
import { ROLE_IDS } from "../src/shared/protocol.ts";

// The party's art is complete and licensed (CLAUDE.md rule 12, and the Design
// block). Read off the files themselves and the app that serves them, not off
// what the manifest claims.
const base = inject("baseUrl");
const ASSETS = "src/assets";
const REQUIRED = ["idle", "attack", "hurt", "down"] as const;

interface Animation {
  frames: number[];
  sheet?: string;
  cell?: [number, number];
  columns?: number;
}
interface Role {
  sheet: string;
  portrait: string;
  cell: [number, number];
  columns: number;
  animations: Record<string, Animation>;
}
const manifest = JSON.parse(readFileSync(join(ASSETS, "sprites.json"), "utf8")) as { roles: Record<string, Role> };
const png = (path: string): Image => decodePng(readFileSync(join(ASSETS, path)));

function cellOf(role: Role, anim: Animation, index: number): Image {
  const sheet = png(anim.sheet ?? role.sheet);
  const [w, h] = anim.cell ?? role.cell;
  const columns = anim.columns ?? role.columns;
  const x = (index % columns) * w;
  const y = Math.floor(index / columns) * h;
  expect(x + w <= sheet.width && y + h <= sheet.height, `frame ${index} is outside ${anim.sheet ?? role.sheet}`).toBe(true);
  return crop(sheet, x, y, w, h);
}

describe("the party's sprites", () => {
  it("every sprite has every required frame (idle, attack, hurt, down)", async () => {
    for (const roleId of ROLE_IDS) {
      const role = manifest.roles[roleId];
      expect(role, `sprites.json has no ${roleId}`).toBeTruthy();
      for (const name of REQUIRED) {
        const anim = role.animations[name];
        expect(anim?.frames?.length, `${roleId} has no ${name} frames`).toBeGreaterThan(0);
        for (const index of anim.frames) {
          expect(contentBox(cellOf(role, anim, index), 0), `${roleId} ${name} frame ${index} is an empty cell`).not.toBeNull();
        }
      }
      // ...and the app serves every file a sprite needs, as an image.
      const files = new Set([role.sheet, role.portrait, ...Object.values(role.animations).flatMap((a) => (a.sheet ? [a.sheet] : []))]);
      for (const file of files) {
        const res = await fetch(new URL(`/assets/${file}`, base));
        expect(res.status, `GET /assets/${file}`).toBe(200);
        expect(res.headers.get("content-type"), `/assets/${file}`).toMatch(/^image\/png/);
      }
    }
  });

  it("tells the four roles apart in silhouette at 24px", () => {
    // Each idle pose, trimmed, scaled to 24px tall by box-averaging its alpha,
    // and compared pair by pair. Two roles that overlap this much are one
    // shape to a glance.
    const silhouettes = ROLE_IDS.map((roleId) => {
      const role = manifest.roles[roleId];
      const cell = cellOf(role, role.animations.idle, role.animations.idle.frames[0]);
      const box = contentBox(cell, 0) as { x: number; y: number; w: number; h: number };
      const h = 24;
      const w = Math.max(1, Math.round((box.w * h) / box.h));
      const mask: boolean[][] = [];
      for (let y = 0; y < h; y++) {
        mask.push([]);
        for (let x = 0; x < w; x++) {
          let sum = 0;
          let n = 0;
          for (let sy = Math.floor((y * box.h) / h); sy < Math.ceil(((y + 1) * box.h) / h); sy++) {
            for (let sx = Math.floor((x * box.w) / w); sx < Math.ceil(((x + 1) * box.w) / w); sx++) {
              sum += cell.data[((box.y + sy) * cell.width + box.x + sx) * 4 + 3];
              n++;
            }
          }
          mask[y].push(sum / n >= 128);
        }
      }
      return { roleId, mask, w };
    });
    const width = Math.max(...silhouettes.map((s) => s.w));
    const at = (s: (typeof silhouettes)[number], x: number, y: number) => {
      const sx = x - Math.floor((width - s.w) / 2);
      return sx >= 0 && sx < s.w && s.mask[y][sx];
    };
    for (let i = 0; i < silhouettes.length; i++) {
      for (let j = i + 1; j < silhouettes.length; j++) {
        let both = 0;
        let either = 0;
        for (let y = 0; y < 24; y++) {
          for (let x = 0; x < width; x++) {
            const p = at(silhouettes[i], x, y);
            const q = at(silhouettes[j], x, y);
            both += Number(p && q);
            either += Number(p || q);
          }
        }
        expect(both / either, `${silhouettes[i].roleId} and ${silhouettes[j].roleId} share most of their 24px silhouette`).toBeLessThan(0.8);
      }
    }
  });
});

describe("every asset is licensed", () => {
  const ALLOWED = new Set(["CC0-1.0", "CC-BY-3.0", "CC-BY-4.0"]);
  const credits = readFileSync("CREDITS.md", "utf8");
  const rows = credits
    .split("\n")
    .map((line) => /^\|\s*`([^`]+)`\s*\|(.*)\|\s*$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => {
      const [source, author, licence] = m[2].split("|").map((cell) => cell.trim());
      return { path: m[1], source, author, licence, line: m[0] };
    });

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [relative(ASSETS, path)];
    });
  }

  it("every file under src/assets/ is listed in CREDITS.md with an allowed licence", () => {
    const shipped = files(ASSETS);
    expect(shipped.length, "found nothing under src/assets/ to check").toBeGreaterThan(0);
    for (const file of shipped) {
      const row = rows.find((r) => r.path === file || (r.path.endsWith("/") && file.startsWith(r.path)));
      expect(row, `src/assets/${file} has no row in CREDITS.md`).toBeTruthy();
      if (!row) continue;
      expect(ALLOWED.has(row.licence), `src/assets/${file} is "${row.licence}"; only ${[...ALLOWED].join(", ")} may ship`).toBe(true);
      expect(row.source, `src/assets/${file} has no source URL`).toMatch(/https:\/\//);
      expect(row.author, `src/assets/${file} has no author`).not.toBe("");
      expect(row.line, `src/assets/${file}'s row mentions a share-alike, non-commercial or personal-use term`).not.toMatch(
        /\bSA\b|share-?alike|\bNC\b|non-?commercial|personal use/i,
      );
    }
  });

  it("lists nothing that isn't there", () => {
    const shipped = new Set(files(ASSETS));
    const stale = rows.filter((r) => (r.path.endsWith("/") ? ![...shipped].some((f) => f.startsWith(r.path)) : !shipped.has(r.path)));
    expect(stale.map((r) => r.path), "CREDITS.md rows with no file behind them").toEqual([]);
  });
});
