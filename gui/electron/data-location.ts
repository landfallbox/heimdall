import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import fsp from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

export const POINTER_FILE_NAME = "data-location.ini";
const POINTER_SECTION = "Heimdall";
const POINTER_KEY = "DataDirectory";

/**
 * Electron/Chromium runtime artifacts that carry no user data. They stay in the
 * previous directory instead of being copied, and are never deleted.
 */
export const MIGRATION_SKIP_ENTRIES: ReadonlySet<string> = new Set([
  POINTER_FILE_NAME,
  "router.pid",
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "Crashpad",
  "Crash Reports",
  "blob_storage",
  "Local Storage",
  "Session Storage",
  "IndexedDB",
  "Network",
  "Partitions",
  "DIPS",
  "DIPS-wal",
  "SharedStorage",
  "SharedStorage-wal",
  "Shared Dictionary",
  "Preferences",
  "lockfile",
  "Local State",
  ".updaterId",
]);

export interface DataDirTargetResult {
  ok: boolean;
  path: string;
  error: string;
}

export interface MigrationResult {
  files: number;
  bytes: number;
  migrated: string[];
  skipped: string[];
  leftovers: number;
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16_LE_BOM = Buffer.from([0xff, 0xfe]);

/**
 * The pointer has to live at a fixed location, so it always stays in the default
 * userData folder while every other file follows the directory it points at.
 */
export function pointerFilePath(defaultUserDataDir: string): string {
  return join(defaultUserDataDir, POINTER_FILE_NAME);
}

export function readDataDirPointer(pointerPath: string): string | null {
  try {
    return parseDataDirPointer(decodePointerBytes(readFileSync(pointerPath)));
  } catch {
    return null;
  }
}

function decodePointerBytes(buffer: Buffer): string {
  if (buffer.subarray(0, 2).equals(UTF16_LE_BOM)) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.subarray(0, 3).equals(UTF8_BOM)) {
    return buffer.subarray(3).toString("utf8");
  }

  const text = buffer.toString("utf8");
  if (!text.includes("\uFFFD")) {
    return text;
  }

  // NSIS writes the installer-chosen path with the system ANSI code page, so a
  // non-ASCII path picked during installation is only recoverable that way.
  try {
    return new TextDecoder("gbk").decode(buffer);
  } catch {
    return text;
  }
}

export function parseDataDirPointer(text: string): string | null {
  let inSection = false;

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      const end = line.indexOf("]");
      inSection = end > 0 && line.slice(1, end).toLowerCase() === POINTER_SECTION.toLowerCase();
      continue;
    }
    if (!inSection || !line.includes("=")) {
      continue;
    }

    const [key, ...rest] = line.split("=");
    if (key.trim().toLowerCase() === POINTER_KEY.toLowerCase()) {
      const value = rest.join("=").trim();
      return value || null;
    }
  }

  return null;
}

export function formatDataDirPointer(dataDir: string | null): string {
  return `[${POINTER_SECTION}]\r\n${POINTER_KEY}=${dataDir || ""}\r\n`;
}

/** An empty value means "use the default folder", matching what NSIS writes. */
export async function writeDataDirPointer(pointerPath: string, dataDir: string | null): Promise<void> {
  await fsp.mkdir(dirname(pointerPath), { recursive: true });
  const temporaryPath = `${pointerPath}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, formatDataDirPointer(dataDir), "utf8");

  try {
    await fsp.rename(temporaryPath, pointerPath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => null);
    throw error;
  }
}

export function ensureDataDirUsable(dataDir: string): boolean {
  try {
    mkdirSync(dataDir, { recursive: true });
    accessSync(dataDir, constants.W_OK);
    return existsSync(dataDir);
  } catch {
    return false;
  }
}

export function sameDirectoryPath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  return normalizeDirectoryForCompare(a, platform) === normalizeDirectoryForCompare(b, platform);
}

function normalizeDirectoryForCompare(path: string, platform: NodeJS.Platform): string {
  const trimmed = stripTrailingSeparators(resolve(path));
  return platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

function stripTrailingSeparators(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed || path.slice(0, 1);
}

export function isWithinDirectory(parent: string, child: string, platform: NodeJS.Platform = process.platform): boolean {
  const relativePath = relative(normalizeDirectoryForCompare(parent, platform), normalizeDirectoryForCompare(child, platform));
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

export function validateDataDirTarget({
  target,
  currentDataDir,
  defaultUserDataDir,
  installDir = "",
  platform = process.platform,
}: {
  target: string;
  currentDataDir: string;
  defaultUserDataDir: string;
  installDir?: string;
  platform?: NodeJS.Platform;
}): DataDirTargetResult {
  const trimmed = String(target || "").trim().replace(/^"|"$/g, "");

  if (!trimmed) {
    return { ok: false, path: "", error: "Enter a data directory path." };
  }
  if (!isAbsolute(trimmed)) {
    return { ok: false, path: "", error: "The data directory must be an absolute path." };
  }

  const candidate = resolve(trimmed);

  if (stripTrailingSeparators(candidate) === stripTrailingSeparators(parse(candidate).root)) {
    return { ok: false, path: candidate, error: "Choose a folder instead of a drive root." };
  }

  if (installDir && isWithinDirectory(installDir, candidate, platform)) {
    return { ok: false, path: candidate, error: "The data directory cannot live inside the installation folder, which uninstall removes." };
  }

  const backToDefault = sameDirectoryPath(candidate, defaultUserDataDir, platform);

  // Picking the current directory itself is a no-op move, not a containment
  // violation: isWithinDirectory() reports equality as "within", which would
  // otherwise reject the choice with a misleading error.
  if (
    !backToDefault &&
    !sameDirectoryPath(candidate, currentDataDir, platform) &&
    (isWithinDirectory(currentDataDir, candidate, platform) || isWithinDirectory(candidate, currentDataDir, platform))
  ) {
    return { ok: false, path: candidate, error: "The new data directory cannot contain or be contained by the current one." };
  }

  return { ok: true, path: candidate, error: "" };
}

/**
 * Top-level entries that exist in both directories and the migration would
 * overwrite. Used to refuse moving into a folder that already holds files the
 * user did not mean to replace.
 */
export async function listMigrationConflicts(from: string, to: string): Promise<string[]> {
  const sourceEntries = await fsp.readdir(from).catch(() => [] as string[]);
  const movable = sourceEntries.filter((entry) => !MIGRATION_SKIP_ENTRIES.has(entry) && !entry.startsWith(".config-"));
  if (movable.length === 0) {
    return [];
  }
  const targetEntries = new Set(await fsp.readdir(to).catch(() => [] as string[]));
  return movable.filter((entry) => targetEntries.has(entry));
}

/**
 * Copies every user file into `to`, verifies both trees match, and only then
 * deletes the copied entries from `from`. Skipped runtime artifacts stay behind.
 */
export async function migrateDataDirContents({
  from,
  to,
}: {
  from: string;
  to: string;
}): Promise<MigrationResult> {
  if (sameDirectoryPath(from, to)) {
    return { files: 0, bytes: 0, migrated: [], skipped: [], leftovers: 0 };
  }

  await fsp.mkdir(to, { recursive: true });
  const entries = await fsp.readdir(from).catch(() => [] as string[]);
  const migrated: string[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    if (MIGRATION_SKIP_ENTRIES.has(entry) || entry.startsWith(".config-")) {
      skipped.push(entry);
      continue;
    }

    await fsp.cp(join(from, entry), join(to, entry), { recursive: true, force: true, preserveTimestamps: true });
    migrated.push(entry);
  }

  const sourceManifest = await readManifest(from, migrated);
  const targetManifest = await readManifest(to, migrated);

  if (manifestDiffers(sourceManifest, targetManifest)) {
    throw new Error(`Copy verification failed; the previous data directory at ${from} was left untouched.`);
  }

  for (const entry of migrated) {
    await fsp.rm(join(from, entry), { recursive: true, force: true });
  }
  await fsp.rmdir(from).catch(() => null);

  return {
    files: sourceManifest.size,
    bytes: manifestBytes(sourceManifest),
    migrated,
    skipped,
    leftovers: (await fsp.readdir(from).catch(() => [] as string[])).length,
  };
}

async function readManifest(root: string, names: string[]): Promise<Map<string, number>> {
  const manifest = new Map<string, number>();

  async function walk(directory: string, prefix: string): Promise<void> {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const key = `${prefix}/${entry.name}`;

      if (entry.isDirectory()) {
        await walk(path, key);
      } else if (entry.isFile()) {
        manifest.set(key, (await fsp.stat(path)).size);
      }
    }
  }

  for (const name of names) {
    const path = join(root, name);
    const stats = await fsp.stat(path).catch(() => null);

    if (stats?.isDirectory()) {
      await walk(path, name);
    } else if (stats?.isFile()) {
      manifest.set(name, stats.size);
    }
  }

  return manifest;
}

function manifestDiffers(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) {
    return true;
  }

  for (const [path, size] of a) {
    if (b.get(path) !== size) {
      return true;
    }
  }

  return false;
}

function manifestBytes(manifest: Map<string, number>): number {
  return [...manifest.values()].reduce((total, size) => total + size, 0);
}
