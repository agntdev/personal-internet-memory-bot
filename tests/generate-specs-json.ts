import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const specsDir = join(import.meta.dirname, "specs");
const files = readdirSync(specsDir).filter((f) => f.endsWith(".json")).sort();
const specs = files.map((f) => JSON.parse(readFileSync(join(specsDir, f), "utf8")));

writeFileSync(join(import.meta.dirname, "specs.json"), JSON.stringify(specs, null, 2));
console.log(`Generated specs.json with ${specs.length} specs`);