import { Loader2, Save, Server } from "lucide-react";

import { Field } from "../components/field.tsx";
import { SecretInput } from "../components/secret-input.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardAction, CardContent, CardHeader } from "../components/ui/card.tsx";
import { Input } from "../components/ui/input.tsx";
import type { Draft } from "../config-draft.ts";
import type { ValidationResult } from "../app-model.ts";

interface RouterPageProps {
  draft: Draft;
  onUpdateRouter: (field: string, value: string) => void;
  showRouterKey: boolean;
  onSetShowRouterKey: (value: boolean) => void;
  onCopyRouterApiKey: () => Promise<void>;
  onSaveRouter: () => Promise<void>;
  busy: string;
  validation: ValidationResult;
}

export function RouterPage({
  draft,
  onUpdateRouter,
  showRouterKey,
  onSetShowRouterKey,
  onCopyRouterApiKey,
  onSaveRouter,
  busy,
  validation,
}: RouterPageProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Server size={16} />
          </span>
          <h2 className="text-[15px] font-semibold tracking-tight">Router</h2>
        </div>
        <CardAction>
          <Button
            onClick={() => void onSaveRouter()}
            disabled={validation.hasErrors || busy === "saveRouter"}
            title="Save Router settings to config.json."
          >
            {busy === "saveRouter" ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
            Save
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-x-4 gap-y-5">
          <Field label="Port" message={validation.fields.port?.message} tone={validation.fields.port?.tone}>
            <Input
              value={draft.router.port}
              inputMode="numeric"
              onChange={(event) => onUpdateRouter("port", event.target.value)}
              aria-label="Router port"
            />
          </Field>
          <Field label="Router API key" wide className="col-span-2">
            <SecretInput
              value={draft.router.apiKey}
              onChange={(value) => onUpdateRouter("apiKey", value)}
              show={showRouterKey}
              onToggleShow={() => onSetShowRouterKey(!showRouterKey)}
              onCopy={() => void onCopyRouterApiKey()}
              ariaLabel="Router API key"
            />
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}
