import { TOOL_CATALOG } from "../src/tools/catalog.ts";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const outDir = join(import.meta.dir, "..", "site", "src", "data");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "tools.json"),
  JSON.stringify(TOOL_CATALOG, null, 2)
);
console.log(`Exported ${TOOL_CATALOG.length} tool groups to site/src/data/tools.json`);
