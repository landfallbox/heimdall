import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  MIGRATION_SKIP_ENTRIES,
  formatDataDirPointer,
  isWithinDirectory,
  listMigrationConflicts,
  migrateDataDirContents,
  parseDataDirPointer,
  readDataDirPointer,
  sameDirectoryPath,
  validateDataDirTarget,
  writeDataDirPointer,
} from "../gui/electron/data-location.ts";

// 1. Pointer text round-trips through the ini format.
assert.equal(parseDataDirPointer("[Heimdall]\r\nDataDirectory=D:\\HeimdallData\r\n"), "D:\\HeimdallData");
assert.equal(parseDataDirPointer(formatDataDirPointer("D:\\HeimdallData")), "D:\\HeimdallData");
assert.equal(formatDataDirPointer(null), "[Heimdall]\r\nDataDirectory=\r\n");
assert.equal(parseDataDirPointer(formatDataDirPointer(null)), null);
assert.equal(parseDataDirPointer("[Heimdall]\r\nDataDirectory=\r\n"), null);
assert.equal(parseDataDirPointer("[Other]\r\nDataDirectory=D:\\HeimdallData\r\n"), null);
assert.equal(parseDataDirPointer("[Heimdall]\r\nDataFolder=D:\\HeimdallData\r\n"), null);
assert.equal(parseDataDirPointer("DataDirectory=D:\\HeimdallData\r\n"), null);
assert.equal(parseDataDirPointer("[Heimdall]\r\nDataDirectory=D:\\a=b\r\n"), "D:\\a=b");
assert.equal(parseDataDirPointer(""), null);
assert.equal(parseDataDirPointer(formatDataDirPointer("D:\\a=b")), "D:\\a=b");
assert.equal(formatDataDirPointer("D:\\a=b"), "[Heimdall]\r\nDataDirectory=D:\\a=b\r\n");

type TargetFixtures = {
  label: string;
  current: string;
  install: string;
  driveRoot: string;
  fresh: string;
  other: string;
  childOfCurrent: string;
  parentOfCurrent: string;
  insideInstall: string;
};

// `validateDataDirTarget` compares through the host's path module, so drive letter
// fixtures can only be exercised on Windows. The neutral fixtures use leading-slash
// paths that resolve the same way on win32 and non-win32 hosts, which keeps the same
// assertions meaningful on the macOS leg of CI. `linux` stands in for any non-win32
// platform here, since Node only accepts real `NodeJS.Platform` values.
const win32Fixtures: TargetFixtures = {
  label: "win32 drive paths",
  current: "C:\\Users\\x\\AppData\\Roaming\\Heimdall",
  install: "C:\\Program Files\\Heimdall",
  driveRoot: "D:\\",
  fresh: "D:\\HeimdallData",
  other: "E:\\OtherData",
  childOfCurrent: "C:\\Users\\x\\AppData\\Roaming\\Heimdall\\sub",
  parentOfCurrent: "C:\\Users\\x\\AppData\\Roaming",
  insideInstall: "C:\\Program Files\\Heimdall\\data",
};

const neutralFixtures: TargetFixtures = {
  label: "neutral absolute paths",
  current: "/Users/x/AppData/Roaming/Heimdall",
  install: "/Program Files/Heimdall",
  driveRoot: "/",
  fresh: "/Data/HeimdallData",
  other: "/OtherData",
  childOfCurrent: "/Users/x/AppData/Roaming/Heimdall/sub",
  parentOfCurrent: "/Users/x/AppData/Roaming",
  insideInstall: "/Program Files/Heimdall/data",
};

function validateTarget(fixtures: TargetFixtures, target: string, currentDataDir = fixtures.current) {
  return validateDataDirTarget({
    target,
    currentDataDir,
    defaultUserDataDir: fixtures.current,
    installDir: fixtures.install,
    platform: "win32",
  });
}

function assertRejected(result: { ok: boolean; error: string }, label: string) {
  assert.equal(result.ok, false, `${label} must be rejected`);
  assert.ok(typeof result.error === "string" && result.error.length > 0, `${label} must carry an error message`);
}

function assertTargetRules(fixtures: TargetFixtures) {
  const at = (path: string) => resolve(path);

  assertRejected(validateTarget(fixtures, ""), `${fixtures.label}: empty path`);
  assertRejected(validateTarget(fixtures, "   "), `${fixtures.label}: blank path`);
  assertRejected(validateTarget(fixtures, "data"), `${fixtures.label}: relative path`);
  assertRejected(validateTarget(fixtures, fixtures.driveRoot), `${fixtures.label}: drive root`);
  assertRejected(validateTarget(fixtures, fixtures.insideInstall), `${fixtures.label}: inside the installation folder`);
  assertRejected(validateTarget(fixtures, fixtures.install), `${fixtures.label}: the installation folder itself`);
  assertRejected(validateTarget(fixtures, fixtures.childOfCurrent), `${fixtures.label}: inside the current data directory`);
  assertRejected(validateTarget(fixtures, fixtures.parentOfCurrent), `${fixtures.label}: containing the current data directory`);

  const moved = validateTarget(fixtures, fixtures.fresh);
  assert.equal(moved.ok, true, `${fixtures.label}: a fresh sibling folder is accepted`);
  assert.equal(moved.error, "");
  assert.equal(moved.path, at(fixtures.fresh));

  // Going back to the default folder is the restore-default flow, so the containment
  // guard must not fire even though the current folder is the migrated one.
  const restored = validateTarget(fixtures, fixtures.current, fixtures.fresh);
  assert.equal(restored.ok, true, `${fixtures.label}: restoring the default folder is accepted`);
  assert.equal(restored.error, "");
  assert.equal(restored.path, at(fixtures.current));

  // Re-picking the current (non-default) folder is a no-op move, not a
  // containment violation: isWithinDirectory() reports equality as "within".
  const repicked = validateTarget(fixtures, fixtures.fresh, fixtures.fresh);
  assert.equal(repicked.ok, true, `${fixtures.label}: re-picking the current folder is accepted`);
  assert.equal(repicked.path, at(fixtures.fresh));

  // Surrounding whitespace, quoting and a trailing separator are all tolerated.
  const quoted = `  "${fixtures.fresh}${fixtures === win32Fixtures ? "\\" : "/"}"  `;
  const trimmed = validateTarget(fixtures, quoted, fixtures.other);
  assert.equal(trimmed.ok, true, `${fixtures.label}: quoted path with a trailing separator is accepted`);
  assert.equal(trimmed.path, at(fixtures.fresh));
}

// 4. validateDataDirTarget guards the choices that would corrupt an install.
if (process.platform === "win32") {
  assertTargetRules(win32Fixtures);
}
assertTargetRules(neutralFixtures);

// 4b. Directory comparison: case-folded on Windows, verbatim everywhere else.
assert.equal(sameDirectoryPath("/Data/HeimdallData", "/data/heimdallDATA", "win32"), true);
assert.equal(sameDirectoryPath("/Data/HeimdallData/", "/Data/HeimdallData", "win32"), true);
assert.equal(sameDirectoryPath("/Data/HeimdallData", "/Data/OtherData", "win32"), false);
assert.equal(sameDirectoryPath("/Data/HeimdallData", "/data/heimdallDATA", "linux"), false);
assert.equal(isWithinDirectory("/Program Files/Heimdall", "/Program Files/Heimdall/data", "win32"), true);
assert.equal(isWithinDirectory("/Program Files/Heimdall", "/Program Files/Heimdall", "win32"), true);
assert.equal(isWithinDirectory("/Program Files/Heimdall", "/Data/HeimdallData", "win32"), false);
assert.equal(isWithinDirectory("/Users/x/AppData/Roaming/Heimdall", "/Users/x/AppData/Roaming", "win32"), false, "an ancestor is not inside");
assert.equal(isWithinDirectory("/Users/x/AppData/Roaming/Heimdall", "/Windows", "win32"), false, "an unrelated branch is not inside");
assert.equal(isWithinDirectory("/Users/x/AppData/Roaming/Heimdall", "/Users/x/AppData/Roaming/Heimdall/sub", "win32"), true);
assert.equal(isWithinDirectory("/Users/x/AppData/Roaming/Heimdall", "/Users/x/Desktop", "linux"), false);
if (process.platform === "win32") {
  assert.equal(sameDirectoryPath("d:\\heimdalldata", "D:\\HeimdallData", "win32"), true);
  assert.equal(sameDirectoryPath("D:\\HeimdallData\\", "D:\\HeimdallData", "win32"), true);
  assert.equal(sameDirectoryPath("d:\\heimdalldata", "D:\\HeimdallData"), true, "the platform argument defaults to the host");
}

const tempDirectory = mkdtempSync(join(tmpdir(), "data-location-test-"));

try {
  // 2. readDataDirPointer tolerates every encoding an installer may leave behind.
  const plainPath = join(tempDirectory, "plain.ini");
  writeFileSync(plainPath, formatDataDirPointer("D:\\HeimdallData"), "utf8");
  assert.equal(readDataDirPointer(plainPath), "D:\\HeimdallData");

  const utf8BomPath = join(tempDirectory, "utf8-bom.ini");
  writeFileSync(utf8BomPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(formatDataDirPointer("D:\\HeimdallData"), "utf8")]));
  assert.equal(readDataDirPointer(utf8BomPath), "D:\\HeimdallData");

  const nonAsciiDir = "D:\\数据\\heimdall";
  const utf16BomPath = join(tempDirectory, "utf16-bom.ini");
  writeFileSync(utf16BomPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(formatDataDirPointer(nonAsciiDir), "utf16le")]));
  assert.equal(readDataDirPointer(utf16BomPath), nonAsciiDir);

  // NSIS writes the installer-chosen path with the system ANSI code page ("数据" is CA FD BE DD in GBK).
  let gbkDecoder: TextDecoder | null = null;
  try {
    gbkDecoder = new TextDecoder("gbk");
  } catch {
    gbkDecoder = null;
  }
  if (gbkDecoder) {
    const gbkBytes = Buffer.concat([
      Buffer.from("[Heimdall]\r\nDataDirectory=D:\\", "latin1"),
      Buffer.from([0xca, 0xfd, 0xbe, 0xdd]),
      Buffer.from("\\heimdall\r\n", "latin1"),
    ]);
    const gbkPath = join(tempDirectory, "gbk.ini");
    writeFileSync(gbkPath, gbkBytes);
    assert.equal(gbkBytes.toString("utf8").includes("\uFFFD"), true, "the fixture must be undecodable as UTF-8");
    assert.equal(gbkDecoder.decode(gbkBytes).includes(nonAsciiDir), true, "the fixture must be valid GBK");
    assert.equal(readDataDirPointer(gbkPath), nonAsciiDir);
  }

  assert.equal(readDataDirPointer(join(tempDirectory, "does-not-exist.ini")), null);

  // 3. writeDataDirPointer creates its folder, overwrites in place and leaves no temp files.
  const pointerPath = join(tempDirectory, "nested", "data-location.ini");
  await writeDataDirPointer(pointerPath, "D:\\HeimdallData");
  assert.equal(existsSync(dirname(pointerPath)), true);
  assert.equal(readDataDirPointer(pointerPath), "D:\\HeimdallData");

  await writeDataDirPointer(pointerPath, "E:\\OtherData");
  assert.equal(readDataDirPointer(pointerPath), "E:\\OtherData");
  assert.equal(readFileSync(pointerPath, "utf8"), formatDataDirPointer("E:\\OtherData"));

  await writeDataDirPointer(pointerPath, null);
  assert.equal(readDataDirPointer(pointerPath), null);
  assert.deepEqual(readdirSync(dirname(pointerPath)).filter((name) => name.endsWith(".tmp")), []);
  assert.deepEqual(readdirSync(dirname(pointerPath)), ["data-location.ini"]);

  // 6. Migrating a directory onto itself changes nothing (exercised before the copy
  // path because it short-circuits and touches no files).
  const sameDirectory = join(tempDirectory, "same-dir");
  mkdirSync(sameDirectory, { recursive: true });
  writeFileSync(join(sameDirectory, "config.json"), "{}", "utf8");

  const sameResult = await migrateDataDirContents({ from: sameDirectory, to: sameDirectory });

  assert.deepEqual(sameResult, { files: 0, bytes: 0, migrated: [], skipped: [], leftovers: 0 });
  assert.equal(readFileSync(join(sameDirectory, "config.json"), "utf8"), "{}");
  assert.deepEqual(readdirSync(sameDirectory), ["config.json"]);

  // 5. Migration moves user data only, verifies the copy, and keeps runtime artifacts.
  const from = join(tempDirectory, "migration", "from");
  const to = join(tempDirectory, "migration", "to");
  mkdirSync(join(from, "logs"), { recursive: true });
  mkdirSync(join(from, "usage"), { recursive: true });

  const userFiles: Record<string, string> = {
    "config.json": JSON.stringify({ version: 1, note: "用户配置" }),
    "logs/router.log": "line one\nline two\n",
    "usage/2026-09.jsonl": '{"model":"gpt-4o"}\n',
  };
  const runtimeFiles: Record<string, string> = {
    "router.pid": "4242",
    "data-location.ini": formatDataDirPointer(from),
    ".config-abc123.tmp": "half written",
  };
  for (const files of [userFiles, runtimeFiles]) {
    for (const [relativePath, content] of Object.entries(files)) {
      writeFileSync(join(from, ...relativePath.split("/")), content, "utf8");
    }
  }
  const expectedBytes = Object.values(userFiles).reduce((total, content) => total + Buffer.byteLength(content, "utf8"), 0);

  const result = await migrateDataDirContents({ from, to });

  for (const [relativePath, content] of Object.entries(userFiles)) {
    assert.equal(readFileSync(join(to, ...relativePath.split("/")), "utf8"), content, `${relativePath} must survive migration`);
  }
  assert.equal(existsSync(join(to, "logs")), true, "nested folders are preserved");
  assert.equal(existsSync(join(to, "usage")), true, "nested folders are preserved");
  for (const name of Object.keys(runtimeFiles)) {
    assert.equal(existsSync(join(to, name)), false, `${name} must not be copied`);
  }
  for (const relativePath of Object.keys(userFiles)) {
    assert.equal(existsSync(join(from, ...relativePath.split("/"))), false, `${relativePath} must be removed from the source`);
  }
  for (const name of Object.keys(runtimeFiles)) {
    assert.equal(existsSync(join(from, name)), true, `${name} must stay in the previous folder`);
  }

  assert.equal(result.files, 3);
  assert.equal(result.bytes, expectedBytes);
  assert.deepEqual([...result.migrated].sort(), ["config.json", "logs", "usage"]);
  assert.ok(result.skipped.includes("router.pid"), "router.pid is skipped");
  assert.ok(result.skipped.includes("data-location.ini"), "the pointer is skipped");
  assert.ok(result.skipped.includes(".config-abc123.tmp"), "writer temp files are skipped");
  assert.ok(MIGRATION_SKIP_ENTRIES.has("router.pid"));
  assert.ok(MIGRATION_SKIP_ENTRIES.has("data-location.ini"));
  assert.equal(result.leftovers, readdirSync(from).length);
  assert.equal(result.leftovers, 3);
  assert.deepEqual(readdirSync(from).sort(), [".config-abc123.tmp", "data-location.ini", "router.pid"]);
  assert.equal(existsSync(from), true, "a non-empty source folder survives the failed rmdir");

  // 7. listMigrationConflicts reports only movable entries present in both
  // folders, so Chromium runtime state (skipped entries) is never a conflict.
  const conflictFrom = join(tempDirectory, "conflicts", "from");
  const conflictTo = join(tempDirectory, "conflicts", "to");
  mkdirSync(conflictFrom, { recursive: true });
  mkdirSync(conflictTo, { recursive: true });
  writeFileSync(join(conflictFrom, "config.json"), "{}", "utf8");
  writeFileSync(join(conflictFrom, "router.pid"), "1", "utf8");
  writeFileSync(join(conflictTo, "config.json"), "{}", "utf8");
  writeFileSync(join(conflictTo, "router.pid"), "2", "utf8");

  assert.deepEqual(await listMigrationConflicts(conflictFrom, conflictTo), ["config.json"], "skipped runtime entries are not conflicts");
  rmSync(join(conflictTo, "config.json"));
  assert.deepEqual(await listMigrationConflicts(conflictFrom, conflictTo), [], "no overlap means no conflict");
  assert.deepEqual(await listMigrationConflicts(conflictFrom, join(tempDirectory, "missing-dir")), [], "a missing target has no conflicts");
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}

console.log("data-location tests passed");
