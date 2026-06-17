import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";

const HARD_LIMIT = 500;
const TARGET_LIMIT = 400;

const INCLUDED_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx", ".py", ".css", ".md"]);

const EXCLUDED_PATHS = new Set([
  "package-lock.json",
  ".git",
  ".next",
  ".venv",
  ".vercel",
  "node_modules",
  "playwright-audit",
  "services/engine/.venv",
  "services/engine/factorlab_engine.egg-info",
  "supabase/migrations",
  "supabase/.temp",
]);

const EXCLUDED_PREFIXES = Array.from(EXCLUDED_PATHS, (excludedPath) => `${excludedPath}/`);

function isExcluded(filePath) {
  return (
    EXCLUDED_PATHS.has(filePath) || EXCLUDED_PREFIXES.some((prefix) => filePath.startsWith(prefix))
  );
}

function countLines(filePath) {
  const contents = readFileSync(filePath, "utf8");

  if (contents.length === 0) {
    return 0;
  }

  const newlineCount = (contents.match(/\n/g) ?? []).length;
  return contents.endsWith("\n") ? newlineCount : newlineCount + 1;
}

function getTrackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return output.split("\0").filter(Boolean);
}

const files = getTrackedFiles().filter((filePath) => {
  return (
    INCLUDED_EXTENSIONS.has(extname(filePath)) && !isExcluded(filePath) && existsSync(filePath)
  );
});

const oversizedFiles = files
  .map((filePath) => ({ filePath, lines: countLines(filePath) }))
  .filter(({ lines }) => lines > TARGET_LIMIT)
  .sort(
    (first, second) => second.lines - first.lines || first.filePath.localeCompare(second.filePath)
  );

const hardLimitFailures = oversizedFiles.filter(({ lines }) => lines > HARD_LIMIT);
const targetWarnings = oversizedFiles.filter(({ lines }) => lines <= HARD_LIMIT);

if (targetWarnings.length > 0) {
  console.warn(
    `File length warnings: ${targetWarnings.length} file(s) exceed ${TARGET_LIMIT} lines.`
  );
  for (const { filePath, lines } of targetWarnings) {
    console.warn(`  ${lines.toString().padStart(4, " ")} ${filePath}`);
  }
}

if (hardLimitFailures.length > 0) {
  console.error(
    `File length errors: ${hardLimitFailures.length} file(s) exceed ${HARD_LIMIT} lines.`
  );
  for (const { filePath, lines } of hardLimitFailures) {
    console.error(`  ${lines.toString().padStart(4, " ")} ${filePath}`);
  }
  process.exit(1);
}

console.log(
  `File length check passed: ${files.length} tracked source file(s) are at or below ${HARD_LIMIT} lines.`
);
