// Production build with enough memory for the type check.
// The type check of this project (large Prisma types, ~450 source files) needs more than Node's default heap on the
// build machine (about 2 GB on Render), where it stopped with "JavaScript heap out of memory" on 2026-11-11.
// NODE_OPTIONS is the only setting Next's build workers inherit, so it is set here rather than as a flag.
// A value someone already set in the environment is respected.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const HEAP_MB = 4096;
const current = process.env.NODE_OPTIONS ?? "";
const NODE_OPTIONS = /--max-old-space-size/.test(current) ? current : `${current} --max-old-space-size=${HEAP_MB}`.trim();
console.log(`build: NODE_OPTIONS=${NODE_OPTIONS}`);

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const r = spawnSync(process.execPath, [next, "build", ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, NODE_OPTIONS } });
process.exit(r.status ?? 1);
