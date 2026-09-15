import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { buildReport } from "./report.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const filePath = args[0];
  if (args.length !== 1 || filePath === undefined) {
    throw new Error("Usage: node dist/cli.js <input.jsonl>");
  }

  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    const report = await buildReport(lines);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } finally {
    lines.close();
    input.destroy();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
