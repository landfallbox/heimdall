import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const packageJson = JSON.parse(readFile(join(projectRoot, "package.json")));
const version = String(packageJson.version || "").trim();
if (!version) {
  throw new Error("package.json does not define a version.");
}

const scriptPath = join(projectRoot, "build", "heimdall.iss");
const expectedOutput = join(projectRoot, "release", `heimdall-Setup-${version}.exe`);

function readFile(path) {
  return readFileSync(path, "utf8");
}

function findIscc() {
  const onPath = spawnSync(process.platform === "win32" ? "where" : "which", ["iscc"], { encoding: "utf8" });
  if (onPath.status === 0) {
    const firstLine = String(onPath.stdout || "").split(/\r?\n/)[0].trim();
    if (firstLine && existsSync(firstLine)) {
      return firstLine;
    }
  }

  const candidates =
    process.platform === "win32"
      ? [
          join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Inno Setup 6", "ISCC.exe"),
          join(process.env.ProgramFiles || "C:\\Program Files", "Inno Setup 6", "ISCC.exe"),
          join(process.env.LOCALAPPDATA || "", "Programs", "Inno Setup 6", "ISCC.exe"),
        ]
      : ["/usr/local/bin/iscc", "/usr/bin/iscc"];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("ISCC (Inno Setup 6 compiler) was not found. Install Inno Setup 6 or add it to PATH.");
}

const iscc = findIscc();
console.log(`Compiling Inno Setup installer with ${iscc} (version ${version})`);

const result = spawnSync(iscc, [`/DAppVersion=${version}`, scriptPath], {
  cwd: projectRoot,
  stdio: "inherit",
});

if (result.status !== 0) {
  throw new Error(`ISCC exited with code ${result.status}.`);
}

if (!existsSync(expectedOutput)) {
  throw new Error(`Expected installer output is missing: ${expectedOutput}`);
}

console.log(`Installer ready: ${expectedOutput}`);
