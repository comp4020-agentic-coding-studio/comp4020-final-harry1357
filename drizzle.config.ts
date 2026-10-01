// `pnpm db:generate` diffs src/server/schema.ts against drizzle/ and writes the
// next migration there. The server applies drizzle/ itself on boot
// (src/server/db.ts), so there is no separate migrate step to forget.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/schema.ts",
  out: "./drizzle",
});
