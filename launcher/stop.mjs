#!/usr/bin/env node
/** Cross-platform stop script — Windows, Linux, macOS */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const launcher = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.mjs");
spawnSync(process.execPath, [launcher, "stop"], { stdio: "inherit" });
