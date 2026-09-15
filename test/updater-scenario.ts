import { checkForUpdates, downloadUpdate, getUpdateState, initializeUpdater, installUpdate, onUpdateState } from "../gui/electron/updater.ts";

const mode = String(process.env.HEIMDALL_MOCK_UPDATE || "");
const states: string[] = [];
onUpdateState((state) => states.push(state.status));

initializeUpdater();
const seq: Record<string, string> = { initial: getUpdateState().status };

if (mode === "available") {
  await checkForUpdates();
  seq.afterCheck = getUpdateState().status;
  await downloadUpdate();
  seq.afterDownload = getUpdateState().status;
  installUpdate();
  seq.afterInstall = getUpdateState().status;
} else if (mode === "not-available") {
  await checkForUpdates();
  seq.afterCheck = getUpdateState().status;
} else if (mode === "error") {
  await checkForUpdates({ manual: true }).catch(() => undefined);
  seq.afterCheck = getUpdateState().status;
} else if (mode === "download-error") {
  await checkForUpdates();
  seq.afterCheck = getUpdateState().status;
  await downloadUpdate().catch(() => undefined);
  seq.afterDownload = getUpdateState().status;
}

console.log(JSON.stringify({ seq, states }));
