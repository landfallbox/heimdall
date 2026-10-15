import * as React from "react";
import { ArrowLeftRight, ChevronDown, Info, Loader2, Plus, RefreshCw, Server, Trash2 } from "lucide-react";

import { Field } from "../components/field.tsx";
import { SecretInput } from "../components/secret-input.tsx";
import { SegmentedControl } from "../components/segmented-control.tsx";
import { ToggleRow } from "../components/toggle-row.tsx";
import { formatPeakHours } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import {
  getVendorModelOptions,
  getVendorModelsLoadMessage,
  isValidCustomPricing,
  suggestCatalogSwitch,
  validateVendor,
} from "../app-model.ts";
import {
  REASONING_EFFORT_LEVELS,
  type ReasoningEffortLevel,
  type RequestFormat,
  type VendorDraft,
  type VendorModelDraft,
  type VendorModelVsCodeDraft,
  getVendorModels,
} from "../config-draft.ts";
import { getCatalogPriceView, isPricingCatalogKey, PRICING_CATALOG_KEYS, PRICING_CATALOG_LABELS } from "../../../src/usage.ts";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent } from "../components/ui/card.tsx";
import { Separator } from "../components/ui/separator.tsx";
import { Input } from "../components/ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select.tsx";

const requestFormatOptions: Array<{ value: RequestFormat; label: string }> = [
  { value: "chat-completions", label: "Chat Completions" },
  { value: "responses", label: "Responses" },
  { value: "embeddings", label: "Embeddings" },
  { value: "custom", label: "Custom" },
];

const currencyOptions = ["USD", "CNY"];

interface VendorEditorPageProps {
  vendor: VendorDraft | null;
  onUpdateVendor: (field: string, value: unknown) => void;
  onUpdateVendorModel: (modelIndex: number, field: string, value: unknown) => void;
  onAddVendorModel: () => void;
  onRemoveVendorModel: (modelIndex: number) => void;
  availableModels: string[];
  vendorModelsError: { field: string; message: string } | null;
  onRefreshVendorModels: () => Promise<void>;
  onLoadVendorModelsOnSelect: () => Promise<void>;
  showVendorKey: boolean;
  onSetShowVendorKey: (value: boolean) => void;
  onCopyVendorApiKey: () => Promise<void>;
  onSaveVendor: () => Promise<void>;
  onRevertVendor: () => void;
  busy: string;
}

export function VendorEditorPage({
  vendor,
  onUpdateVendor,
  onUpdateVendorModel,
  onAddVendorModel,
  onRemoveVendorModel,
  availableModels,
  vendorModelsError,
  onRefreshVendorModels,
  onLoadVendorModelsOnSelect,
  showVendorKey,
  onSetShowVendorKey,
  onCopyVendorApiKey,
  onSaveVendor,
  onRevertVendor,
  busy,
}: VendorEditorPageProps) {
  if (!vendor) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No vendor selected.
      </p>
    );
  }

  const validation = validateVendor(vendor);
  const vendorValidation = {
    ...validation,
    fields: {
      ...validation.fields,
      ...(vendorModelsError && vendorModelsError.field !== "models"
        ? { [vendorModelsError.field]: { tone: "error" as const, message: vendorModelsError.message } }
        : {}),
    },
  };
  const models = getVendorModels(vendor);
  const modelOptions = getVendorModelOptions(vendor, availableModels);
  const modelLoadMessage = getVendorModelsLoadMessage(vendor);

  return (
    <Card className="mx-auto max-w-[840px] rounded-none border-0 bg-transparent p-0 shadow-none">
      <CardContent className="pt-1">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Server size={16} />
          </span>
          <h2 className="text-[15px] font-semibold tracking-tight">Vendor Settings</h2>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
          <Field label="Name" message={vendorValidation.fields.name?.message} tone={vendorValidation.fields.name?.tone}>
            <Input value={vendor.name || ""} onChange={(event) => onUpdateVendor("name", event.target.value)} aria-label="Vendor name" />
          </Field>

          <Field
            label="Authentication"
            message={vendorValidation.fields.authentication?.message}
            tone={vendorValidation.fields.authentication?.tone}
          >
            <SegmentedControl
              options={[
                { value: "none", label: "None" },
                { value: "api-key", label: "API key" },
              ]}
              value={vendor.authentication === "api-key" ? "api-key" : "none"}
              onChange={(value) => onUpdateVendor("authentication", value)}
            />
          </Field>

          <Field
            label="Request format"
            wide
            message={vendorValidation.fields.requestFormat?.message}
            tone={vendorValidation.fields.requestFormat?.tone}
          >
            <SegmentedControl
              options={requestFormatOptions}
              value={vendor.requestFormat || "chat-completions"}
              onChange={(value) => onUpdateVendor("requestFormat", value)}
            />
          </Field>

          <Field
            label="Base URL"
            wide
            message={vendorValidation.fields.baseUrl?.message}
            tone={vendorValidation.fields.baseUrl?.tone}
            hint={
              vendor.requestFormat === "custom" ? (
                <>
                  Custom 格式下，Base URL 是完整的请求路径（不再是路径的前半截），请求将直接转发到该地址，例如{" "}
                  <code>http://127.0.0.1:8002/v1/embeddings</code>。
                </>
              ) : undefined
            }
          >
            <Input value={vendor.baseUrl || ""} onChange={(event) => onUpdateVendor("baseUrl", event.target.value)} aria-label="Base URL" />
          </Field>

          {vendor.authentication === "api-key" && (
            <Field
              label="Vendor API key"
              wide
              message={vendorValidation.fields.apiKey?.message}
              tone={vendorValidation.fields.apiKey?.tone}
            >
              <SecretInput
                value={vendor.apiKey || ""}
                onChange={(value) => onUpdateVendor("apiKey", value)}
                show={showVendorKey}
                onToggleShow={() => onSetShowVendorKey(!showVendorKey)}
                onCopy={() => void onCopyVendorApiKey()}
                ariaLabel="Vendor API key"
              />
            </Field>
          )}

          <div className="col-span-2 mt-2 flex min-w-0 flex-col gap-2.5 border-t border-border/60 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[15px] font-semibold tracking-tight">Models</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={onAddVendorModel}>
                  <Plus size={14} />
                  Add model
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void onRefreshVendorModels()}
                  disabled={busy === "vendorModels"}
                >
                  {busy === "vendorModels" ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                  Refresh available models
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              {models.map((model, index) => (
                <ModelPricingRow
                  key={`${model.id || "model"}-${index}`}
                  model={model}
                  index={index}
                  modelOptions={modelOptions}
                  onUpdateVendorModel={onUpdateVendorModel}
                  onRemoveVendorModel={onRemoveVendorModel}
                  onLoadVendorModelsOnSelect={() => void onLoadVendorModelsOnSelect()}
                />
              ))}
            </div>

            {modelLoadMessage && <small className="text-[11px] leading-snug text-warning">{modelLoadMessage}</small>}
            {vendorModelsError?.field === "models" && (
              <small className="text-[11px] leading-snug text-destructive">{vendorModelsError.message}</small>
            )}
            {vendorValidation.fields.models?.message &&
              !/Enter valid non-negative prices/.test(vendorValidation.fields.models.message) && (
                <small className="text-[11px] leading-snug text-destructive">{vendorValidation.fields.models.message}</small>
              )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function VllmThinkingPill({
  checked,
  disabled = false,
  onToggle,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      className={cn("vllm-thinking-pill", checked && "is-active")}
      data-tooltip="Map reasoning/thinking fields between OpenAI and vLLM"
    >
      <ArrowLeftRight size={13} className="vllm-thinking-pill-icon" />
      <span>vLLM Thinking</span>
    </button>
  );
}

function ModelPricingRow({
  model,
  index,
  modelOptions,
  onUpdateVendorModel,
  onRemoveVendorModel,
  onLoadVendorModelsOnSelect,
}: {
  model: VendorModelDraft;
  index: number;
  modelOptions: string[];
  onUpdateVendorModel: (modelIndex: number, field: string, value: unknown) => void;
  onRemoveVendorModel: (modelIndex: number) => void;
  onLoadVendorModelsOnSelect: () => void;
}) {
  const customPricing = model.pricingMode === "custom";
  const catalogKey = isPricingCatalogKey(model.pricingMode) ? model.pricingMode : "openai";
  const pricingView = getCatalogPriceView(catalogKey, model.id);
  const otherCatalogKey =
    !customPricing && !pricingView && model.id
      ? PRICING_CATALOG_KEYS.find((key) => key !== catalogKey && getCatalogPriceView(key, model.id))
      : null;
  const catalogLabel = PRICING_CATALOG_LABELS[catalogKey];
  const otherCatalogLabel = otherCatalogKey ? PRICING_CATALOG_LABELS[otherCatalogKey] : "";

  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-white/5 bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="grid grid-cols-[76px_minmax(120px,1fr)_auto_38px] items-center gap-2 border-b border-border/60 pb-2.5">
        <ToggleRow
          label={model.enabled === false ? "Off" : "On"}
          checked={model.enabled !== false}
          onCheckedChange={(checked) => onUpdateVendorModel(index, "enabled", checked)}
          compact
          title={model.enabled === false ? "Enable model" : "Disable model"}
        />
        <Select
          value={model.id || undefined}
          onValueChange={(modelId) => {
            onUpdateVendorModel(index, "id", modelId);
            const switchTo = suggestCatalogSwitch(model.pricingMode, modelId);
            if (switchTo) {
              onUpdateVendorModel(index, "pricingMode", switchTo);
            }
          }}
          onOpenChange={(open) => {
            if (open) {
              onLoadVendorModelsOnSelect();
            }
          }}
        >
          <SelectTrigger className="w-full bg-background/40 font-mono text-xs" aria-label="Model id">
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent>
            {modelOptions.map((modelId) => (
              <SelectItem key={modelId} value={modelId} className="font-mono">
                {modelId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <VllmThinkingPill
          checked={model.enableThinking === true}
          disabled={model.enabled === false}
          onToggle={() => onUpdateVendorModel(index, "enableThinking", model.enableThinking !== true)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onRemoveVendorModel(index)}
          title="Remove model"
          aria-label="Remove model"
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 size={15} />
        </Button>
      </div>

      <div className="grid grid-cols-[220px_1fr] items-end gap-2.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Price source</span>
          <Select
            value={model.pricingMode || "openai"}
            onValueChange={(value) => onUpdateVendorModel(index, "pricingMode", value)}
          >
            <SelectTrigger className="w-full bg-background/40" aria-label="Price source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRICING_CATALOG_KEYS.map((key) => (
                <SelectItem key={key} value={key}>
                  {PRICING_CATALOG_LABELS[key]} prices
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <PricingFields
          currency={customPricing ? model.pricingCurrency : pricingView?.pricing?.currency}
          input={customPricing ? model.inputPerMillion : pricingView?.pricing?.inputPerMillion}
          cached={customPricing
            ? model.cachedInputPerMillion
            : pricingView?.pricing?.cachedInputPerMillion ?? pricingView?.pricing?.inputPerMillion}
          output={customPricing ? model.outputPerMillion : pricingView?.pricing?.outputPerMillion}
          editable={customPricing}
          available={customPricing || Boolean(pricingView)}
          onChange={(field, value) => onUpdateVendorModel(index, field, value)}
        />
      </div>

      <VsCodeModelFields model={model} onUpdateVendorModel={onUpdateVendorModel} modelIndex={index} />

      {customPricing && !isValidCustomPricing(model) ? (
        <small className="text-[11px] leading-snug text-destructive">
          Enter valid non-negative prices for {model.id || "this model"}.
        </small>
      ) : customPricing ? null : pricingView?.offPeakPricing ? (
        <small className="text-[11px] leading-snug text-muted-foreground">
          Peak {pricingView.pricing.currency} {pricingView.pricing.inputPerMillion} / {pricingView.pricing.cachedInputPerMillion} /{" "}
          {pricingView.pricing.outputPerMillion} per 1M · Off-peak ({formatPeakHours(pricingView.peakHours)}){" "}
          {pricingView.offPeakPricing.currency} {pricingView.offPeakPricing.inputPerMillion} / {pricingView.offPeakPricing.cachedInputPerMillion} /{" "}
          {pricingView.offPeakPricing.outputPerMillion}
        </small>
      ) : !pricingView && model.id ? (
        <small className="flex items-start gap-1.5 text-[11px] leading-snug text-warning">
          <Info size={12} className="mt-0.5 shrink-0" />
          {otherCatalogKey ? (
            <>
              Not in {catalogLabel} —{" "}
              <button
                type="button"
                className="bg-none p-0 font-bold text-primary underline-offset-2 hover:underline"
                onClick={() => onUpdateVendorModel(index, "pricingMode", otherCatalogKey)}
              >
                switch to {otherCatalogLabel}
              </button>
            </>
          ) : (
            `Not in ${catalogLabel} — use Custom`
          )}
        </small>
      ) : null}
    </div>
  );
}

function PricingFields({
  currency,
  input,
  cached,
  output,
  editable,
  available,
  onChange,
}: {
  currency: string | undefined;
  input: string | number | undefined;
  cached: string | number | undefined;
  output: string | number | undefined;
  editable: boolean;
  available: boolean;
  onChange: (field: string, value: string) => void;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[90px_repeat(3,minmax(0,1fr))] items-end gap-2">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-xs font-semibold text-muted-foreground">Currency</span>
        <Select value={normalizeCurrency(currency)} disabled={!editable} onValueChange={(value) => onChange("pricingCurrency", value)}>
          <SelectTrigger className="w-full bg-background/40" aria-label="Currency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {currencyOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <PriceInput label="Input / 1M" value={String(input ?? "")} onChange={(value) => onChange("inputPerMillion", value)} numeric readOnly={!editable} unavailable={!available} />
      <PriceInput label="Cached / 1M" value={String(cached ?? "")} onChange={(value) => onChange("cachedInputPerMillion", value)} numeric optional readOnly={!editable} unavailable={!available} />
      <PriceInput label="Output / 1M" value={String(output ?? "")} onChange={(value) => onChange("outputPerMillion", value)} numeric readOnly={!editable} unavailable={!available} />
    </div>
  );
}

function normalizeCurrency(value: string | undefined) {
  const normalized = String(value || "USD").trim().toUpperCase();
  return currencyOptions.includes(normalized) ? normalized : "USD";
}

function PriceInput({
  label,
  value,
  onChange,
  numeric = false,
  optional = false,
  readOnly = false,
  unavailable = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
  optional?: boolean;
  readOnly?: boolean;
  unavailable?: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <Input
        value={value}
        inputMode={numeric ? "decimal" : "text"}
        placeholder={unavailable ? "N/A" : optional ? "Same as input" : ""}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className={unavailable ? "border-dashed opacity-55" : undefined}
      />
    </label>
  );
}

function VsCodeModelFields({
  model,
  onUpdateVendorModel,
  modelIndex,
}: {
  model: VendorModelDraft;
  onUpdateVendorModel: (modelIndex: number, field: string, value: unknown) => void;
  modelIndex: number;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const vscode = model.vscode;
  const hasMetadata = Boolean(vscode && Object.keys(vscode).length);

  function updateVsCode(patch: Partial<VendorModelVsCodeDraft>) {
    const next: VendorModelVsCodeDraft = { ...vscode, ...patch };
    // Drop keys that are empty so we never write a useless metadata block.
    for (const key of Object.keys(next) as Array<keyof VendorModelVsCodeDraft>) {
      const value = next[key];
      if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) {
        delete next[key];
      }
    }
    onUpdateVendorModel(modelIndex, "vscode", Object.keys(next).length ? next : undefined);
  }

  function toggleReasoningEffort(level: ReasoningEffortLevel) {
    const current = vscode?.supportsReasoningEffort || [];
    const next = current.includes(level) ? current.filter((item) => item !== level) : [...current, level];
    updateVsCode({ supportsReasoningEffort: next });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="inline-flex w-fit items-center gap-1.5 self-start rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-border/80 hover:text-foreground"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        <ChevronDown className={cn("transition-transform duration-150", expanded && "rotate-180")} size={13} />
        <span>VS Code metadata</span>
        {hasMetadata && (
          <span className="rounded-full bg-primary/12 px-1.5 py-px text-[10px] font-semibold text-primary">
            {Object.keys(vscode as object).length} set
          </span>
        )}
      </button>
      {expanded && (
        <div className="grid grid-cols-3 gap-2.5 rounded-xl border border-border bg-card p-3">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Display name</span>
            <Input value={vscode?.name || ""} placeholder={model.id || "Model id"} onChange={(event) => updateVsCode({ name: event.target.value })} />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Context window</span>
            <Input
              value={vscode?.contextWindow || ""}
              inputMode="numeric"
              placeholder="e.g. 128000"
              onChange={(event) => updateVsCode({ contextWindow: event.target.value })}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Max output tokens</span>
            <Input
              value={vscode?.maxOutputTokens || ""}
              inputMode="numeric"
              placeholder="e.g. 16384"
              onChange={(event) => updateVsCode({ maxOutputTokens: event.target.value })}
            />
          </label>
          <div className="col-span-3 grid grid-cols-3 gap-2">
            <ToggleRow
              label="Tool calling"
              checked={vscode?.toolCalling === true}
              onCheckedChange={(checked) => updateVsCode({ toolCalling: checked })}
              compact
              title="Model can call tools"
            />
            <ToggleRow
              label="Vision"
              checked={vscode?.vision === true}
              onCheckedChange={(checked) => updateVsCode({ vision: checked })}
              compact
              title="Model accepts image input"
            />
            <ToggleRow
              label="Thinking"
              checked={vscode?.thinking === true}
              onCheckedChange={(checked) => updateVsCode({ thinking: checked })}
              compact
              title="Model supports a thinking / reasoning mode"
            />
          </div>
          <div className="col-span-3 flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Reasoning effort</span>
            <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 sm:grid-cols-6">
              {REASONING_EFFORT_LEVELS.map((level) => (
                <ToggleRow
                  key={level}
                  label={level}
                  checked={vscode?.supportsReasoningEffort?.includes(level) === true}
                  onCheckedChange={() => toggleReasoningEffort(level)}
                  compact
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
