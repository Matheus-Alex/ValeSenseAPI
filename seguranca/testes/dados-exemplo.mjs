import { readFile } from "node:fs/promises";

const fixture = new URL("./dados-exemplo.json", import.meta.url);
const contents = await readFile(fixture, "utf8");
console.log(contents);
