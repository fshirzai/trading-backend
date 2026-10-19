import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
for (const folder of ["src", "tests"])
  for (const name of await readdir(folder, { recursive: true })) {
    if (!name.endsWith(".js")) continue;
    const r = spawnSync(process.execPath, ["--check", folder + "/" + name], {
      stdio: "inherit",
    });
    if (r.status) process.exit(r.status);
  }
console.log("JavaScript syntax checks passed");
