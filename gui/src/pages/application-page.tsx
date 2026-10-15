import { Code2, RefreshCw, Settings2 } from "lucide-react";

import { Field } from "../components/field.tsx";
import { SegmentedControl } from "../components/segmented-control.tsx";
import { ToggleRow } from "../components/toggle-row.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Separator } from "../components/ui/separator.tsx";
import type { CloseBehavior } from "../config-draft.ts";
import type { Draft } from "../config-draft.ts";

const closeBehaviorOptions = [
  { value: "tray" as CloseBehavior, label: "Keep in tray" },
  { value: "exit" as CloseBehavior, label: "Exit and stop" },
  { value: "ask" as CloseBehavior, label: "Ask every time" },
];

interface AppSettingsPageProps {
  app: Draft["app"];
  onSetAppSetting: (field: "closeBehavior" | "startAtLogin" | "syncVsCodeModels", value: CloseBehavior | boolean) => Promise<void>;
  onSyncNow: () => Promise<void>;
  busy: string;
}

export function AppSettingsPage({ app, onSetAppSetting, onSyncNow, busy }: AppSettingsPageProps) {
  const saving = busy === "saveApp";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5 text-[15px] font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <Settings2 size={16} />
            </span>
            Window
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Field label="Close button">
            <SegmentedControl
              options={closeBehaviorOptions}
              value={app.closeBehavior}
              onChange={(value) => void onSetAppSetting("closeBehavior", value)}
              disabled={saving}
            />
          </Field>
          <Separator />
          <ToggleRow
            label="Start at login"
            checked={app.startAtLogin === true}
            onCheckedChange={(checked) => void onSetAppSetting("startAtLogin", checked)}
            disabled={saving}
            title="Start Heimdall after signing in"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5 text-[15px] font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <Code2 size={16} />
            </span>
            VS Code sync
          </CardTitle>
          <CardAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onSyncNow()}
              disabled={busy === "vsCodeSync"}
              title="Merge enabled models into VS Code now."
            >
              {busy === "vsCodeSync" ? <RefreshCw className="animate-spin" size={14} /> : <RefreshCw size={14} />}
              Sync now
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ToggleRow
            label="Sync models to VS Code"
            checked={app.syncVsCodeModels === true}
            onCheckedChange={(checked) => void onSetAppSetting("syncVsCodeModels", checked)}
            disabled={saving}
            description="On every save, merge enabled models into VS Code's chatLanguageModels.json without touching other providers or VS Code secrets."
          />
        </CardContent>
      </Card>
    </div>
  );
}
