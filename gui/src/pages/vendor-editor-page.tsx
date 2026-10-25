function cleanTierCondition(raw: string): string {
  const trimmed = raw.trim();
  const upToMatch = trimmed.match(/^0\s*<\s*Tokens?\s*≤\s*(.+)$/i);
  if (upToMatch) {
    return `≤ ${upToMatch[1]}`;
  }
  const rangeMatch = trimmed.match(/^(.+?)\s*<\s*Tokens?\s*≤\s*(.+)$/i);
  if (rangeMatch) {
    return `${rangeMatch[1]} ~ ${rangeMatch[2]}`;
  }
  const gtMatch = trimmed.match(/^Tokens?\s*>\s*(.+)$/i);
  if (gtMatch) {
    return `> ${gtMatch[1]}`;
  }
  return trimmed;
}

import * as React from "react";
import { ArrowLeftRight, Check, ChevronDown, Clock, Copy, Info, Layers, Loader2, Plus, RefreshCw, Server, Trash2 } from "lucide-react";

import { Field } from "../components/field.tsx";
import { SecretInput } from "../components/secret-input.tsx";
import { SegmentedControl } from "../components/segmented-control.tsx";
import { formatCompactTokenCount, formatPeakHours, formatTokenCount } from "../lib/format.ts";
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
import { getDesktopApi } from "../desktop-api.ts";
import {
  getCatalogPriceView,
  isPeakHour,
  isPricingCatalogKey,
  PRICING_CATALOG_KEYS,
  PRICING_CATALOG_LABELS,
} from "../../../src/usage.ts";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent } from "../components/ui/card.tsx";
import { Separator } from "../components/ui/separator.tsx";
import { Input } from "../components/ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover.tsx";
import { Switch } from "../components/ui/switch.tsx";

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
  const [expanded, setExpanded] = React.useState(index < 2);
  const [copied, setCopied] = React.useState(false);
  const copiedTimeoutRef = React.useRef<number | undefined>(undefined);
  const mountedRef = React.useRef(false);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.clearTimeout(copiedTimeoutRef.current);
    };
  }, []);

  async function copyModelId() {
    if (!model.id) {
      return;
    }
    try {
      await getDesktopApi().writeClipboard(model.id);
    } catch {
      await navigator.clipboard.writeText(model.id);
    }
    if (!mountedRef.current) {
      return;
    }
    setCopied(true);
    window.clearTimeout(copiedTimeoutRef.current);
    copiedTimeoutRef.current = window.setTimeout(() => setCopied(false), 1500);
  }

  const priceParts: string[] = [];
  const priceValue = (value: string | number | undefined) => (value === undefined || value === "" ? "—" : String(value));
  if (customPricing || pricingView) {
    priceParts.push(
      priceValue(customPricing ? model.inputPerMillion : pricingView?.pricing?.inputPerMillion),
      priceValue(customPricing ? model.cachedInputPerMillion : pricingView?.pricing?.cachedInputPerMillion ?? pricingView?.pricing?.inputPerMillion),
      priceValue(customPricing ? model.outputPerMillion : pricingView?.pricing?.outputPerMillion),
    );
  }
  const priceCurrency = customPricing ? normalizeCurrency(model.pricingCurrency) : pricingView?.pricing?.currency;
  const priceSummary = priceParts.length ? `${priceCurrency} ${priceParts.join(" / ")} / 1M` : null;
  const isTimeWindow = !customPricing && Boolean(pricingView?.offPeakPricing && pricingView?.peakHours);
  const isTiered = !customPricing && Boolean(pricingView?.tiers?.length);
  const hasSpecialPricing = isTimeWindow || isTiered;
  const specialPricingBadge = isTimeWindow ? "⚡ Peak/Off-Peak" : isTiered ? "📊 Tiered" : null;
  const isPeakNow = isTimeWindow && pricingView?.peakHours ? isPeakHour(new Date(), pricingView.peakHours) : true;

  // Rate selection: null follows default (time-window follows current time, tiered follows base).
  const specialPricingKey = hasSpecialPricing && pricingView ? `${catalogKey}:${model.id}` : null;
  const [specialTier, setSpecialTier] = React.useState<string | null>(null);
  React.useEffect(() => {
    setSpecialTier(null);
  }, [specialPricingKey]);
  const defaultTierKey = isTimeWindow
    ? (isPeakNow ? "peak" : "off-peak")
    : isTiered && pricingView?.tiers
      ? String(Math.max(0, pricingView.tiers.findIndex((tier) => tier.isBase)))
      : "0";
  const activeTierKey = specialTier ?? defaultTierKey;

  const displayPricing = customPricing || !pricingView
    ? null
    : isTimeWindow
      ? (activeTierKey === "off-peak" && pricingView.offPeakPricing ? pricingView.offPeakPricing : pricingView.pricing)
      : isTiered
        ? (() => {
            const tier = pricingView.tiers?.[Number(activeTierKey)];
            return tier
              ? {
                  currency: pricingView.pricing.currency,
                  inputPerMillion: tier.inputPerMillion,
                  cachedInputPerMillion: tier.cachedInputPerMillion ?? null,
                  outputPerMillion: tier.outputPerMillion,
                }
              : pricingView.pricing;
          })()
        : pricingView.pricing;

  const tierOptions = isTimeWindow
    ? [
        { value: "peak", label: isPeakNow ? "Daytime Peak (Base · Active)" : "Daytime Peak (Base)" },
        { value: "off-peak", label: isPeakNow ? "Off-Peak Promo" : "Off-Peak Promo (Active)" },
      ]
    : isTiered && pricingView?.tiers
      ? pricingView.tiers.map((tier, idx) => {
          const cond = cleanTierCondition(tier.condition);
          return {
            value: String(idx),
            label: tier.isBase ? `${cond} (Base)` : cond,
          };
        })
      : [];

  const tierBadge = isTimeWindow
    ? (activeTierKey === "off-peak" ? "Off-Peak" : "Peak")
    : isTiered && pricingView?.tiers
      ? cleanTierCondition(pricingView.tiers[Number(activeTierKey)]?.condition || "")
      : null;

  const contextSummary = vscodeSummaryContext(model);
  const capabilitySummary = vscodeSummaryCapabilities(model);

  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-white/5 bg-card shadow-[0_1px_2px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setExpanded((value) => !value);
          }
        }}
        className="grid grid-cols-[32px_minmax(120px,1fr)_auto_30px] cursor-pointer items-center gap-2 rounded-t-xl bg-foreground/[0.03] px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <Switch
          checked={model.enabled !== false}
          onCheckedChange={(checked) => onUpdateVendorModel(index, "enabled", checked)}
          aria-label={model.enabled === false ? "Enable model" : "Disable model"}
          title={model.enabled === false ? "Enable model" : "Disable model"}
          onClick={(event) => event.stopPropagation()}
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
          <SelectTrigger
            className="w-full bg-background/40 font-mono text-xs"
            aria-label="Model id"
            onClick={(event) => event.stopPropagation()}
          >
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
        <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
          <VllmThinkingPill
            checked={model.enableThinking === true}
            disabled={model.enabled === false}
            onToggle={() => onUpdateVendorModel(index, "enableThinking", model.enableThinking !== true)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void copyModelId()}
            onKeyDown={(event) => event.stopPropagation()}
            disabled={!model.id}
            title="Copy model id"
            aria-label="Copy model id"
            className="text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {copied ? <Check size={15} className="text-success" /> : <Copy size={15} />}
          </Button>
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
        <ChevronDown
          size={15}
          className={cn("justify-self-end text-muted-foreground/70 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]", expanded && "rotate-180")}
        />
      </div>

      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          expanded ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {(priceSummary || contextSummary || capabilitySummary.length > 0) && (
            <div
              className="flex min-w-0 items-center gap-2 px-3 pb-2 text-[11px] text-muted-foreground"
              onClick={(event) => event.stopPropagation()}
            >
              {priceSummary && <span className="shrink-0 font-mono">{priceSummary}</span>}
              {specialPricingBadge && (
                <span className="shrink-0 rounded-full border border-warning/30 bg-warning/10 px-1.5 py-px text-[10px] font-medium text-warning">
                  {specialPricingBadge}
                </span>
              )}
              {contextSummary && (
                <>
                  <span className="text-border">·</span>
                  <span className="shrink-0">{contextSummary}</span>
                </>
              )}
              {capabilitySummary.length > 0 && (
                <>
                  <span className="text-border">·</span>
                  <span className="flex min-w-0 items-center gap-1">
                    {capabilitySummary.map((item) => (
                      <span key={item} className="shrink-0 rounded-full border border-border/70 bg-background/40 px-1.5 py-px text-[10px]">
                        {item}
                      </span>
                    ))}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden" aria-hidden={!expanded} {...(!expanded ? { inert: true } : {})}>
          <div
            className={cn(
              "flex min-w-0 flex-col gap-2.5 p-3 pt-2.5 transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
              expanded ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0",
            )}
          >
          {(() => {
            const sourceSelect = (
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
                      {PRICING_CATALOG_LABELS[key]}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            );
            const priceInputs = (
              <>
                <PriceInput
                  label={`Input / 1M (${normalizeCurrency(customPricing ? model.pricingCurrency : displayPricing?.currency)})`}
                  headerRight={
                    hasSpecialPricing && pricingView ? (
                      <SpecialPricingPopover
                        isTimeWindow={isTimeWindow}
                        isTiered={isTiered}
                        isPeakNow={isPeakNow}
                        activeTierKey={activeTierKey}
                        onSelectTier={setSpecialTier}
                        pricingView={pricingView}
                        currency={normalizeCurrency(customPricing ? model.pricingCurrency : displayPricing?.currency)}
                        tierBadge={tierBadge}
                      />
                    ) : null
                  }
                  value={String(customPricing ? model.inputPerMillion : displayPricing?.inputPerMillion ?? "")}
                  onChange={(value) => onUpdateVendorModel(index, "inputPerMillion", value)}
                  numeric
                  readOnly={!customPricing}
                  unavailable={!customPricing && !displayPricing}
                />
                <PriceInput
                  label="Cached / 1M"
                  value={String(
                    customPricing
                      ? model.cachedInputPerMillion
                      : displayPricing?.cachedInputPerMillion ?? displayPricing?.inputPerMillion ?? "",
                  )}
                  onChange={(value) => onUpdateVendorModel(index, "cachedInputPerMillion", value)}
                  numeric
                  optional
                  readOnly={!customPricing}
                  unavailable={!customPricing && !displayPricing}
                />
                <PriceInput
                  label="Output / 1M"
                  value={String(customPricing ? model.outputPerMillion : displayPricing?.outputPerMillion ?? "")}
                  onChange={(value) => onUpdateVendorModel(index, "outputPerMillion", value)}
                  numeric
                  readOnly={!customPricing}
                  unavailable={!customPricing && !displayPricing}
                />
              </>
            );
            return (
              <div className="grid min-w-0 grid-cols-[136px_repeat(3,minmax(0,1fr))] items-end gap-2.5">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex h-4 items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">Price source</span>
                  </div>
                  {sourceSelect}
                </div>
                {priceInputs}
              </div>
            );
          })()}

          <VsCodeModelFields model={model} onUpdateVendorModel={onUpdateVendorModel} modelIndex={index} />

          {customPricing && !isValidCustomPricing(model) ? (
            <small className="text-[11px] leading-snug text-destructive">
              Enter valid non-negative prices for {model.id || "this model"}.
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
        </div>
      </div>
    </div>
  );
}

function normalizeCurrency(value: string | undefined) {
  const normalized = String(value || "USD").trim().toUpperCase();
  return normalized === "CNY" ? "CNY" : "USD";
}


function SpecialPricingPopover({
  isTimeWindow,
  isTiered,
  isPeakNow,
  activeTierKey,
  onSelectTier,
  pricingView,
  currency,
  tierBadge,
}: {
  isTimeWindow: boolean;
  isTiered: boolean;
  isPeakNow: boolean;
  activeTierKey: string;
  onSelectTier: (tierKey: string) => void;
  pricingView: ReturnType<typeof getCatalogPriceView>;
  currency: string;
  tierBadge: string | null;
}) {
  if (isTimeWindow) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors cursor-pointer outline-none",
              isPeakNow
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20",
            )}
            onClick={(e) => e.stopPropagation()}
            title="View time-of-use rate details"
          >
            <Clock size={10} className="shrink-0" />
            <span>{isPeakNow ? "Peak" : "Off-Peak"}</span>
            <ChevronDown size={10} className="opacity-70" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-3 text-xs space-y-2.5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
              <Clock size={13} className="text-warning" />
              <span>Time-of-Use Rates</span>
            </div>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium border",
                isPeakNow
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
              )}
            >
              {isPeakNow ? "Peak Active" : "Off-Peak Active"}
            </span>
          </div>

          <div className="space-y-1.5">
            {pricingView?.offPeakPricing && (
              <button
                type="button"
                onClick={() => onSelectTier("off-peak")}
                className={cn(
                  "w-full text-left rounded-lg p-2 transition-all border cursor-pointer",
                  activeTierKey === "off-peak"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-foreground"
                    : "bg-muted/15 border-border/40 hover:bg-muted/25 text-muted-foreground",
                )}
              >
                <div className="flex items-center justify-between font-medium text-xs">
                  <span className="flex items-center gap-1.5 text-foreground">
                    <span className={cn("h-1.5 w-1.5 rounded-full", !isPeakNow ? "bg-emerald-400" : "bg-muted-foreground/40")} />
                    Off-Peak Discount
                  </span>
                  <span className="text-[10px] text-emerald-400 font-mono">{!isPeakNow ? "● Current" : "Discount"}</span>
                </div>
                <div className="mt-1 flex items-center justify-between font-mono text-[11px]">
                  <span>In: {pricingView.offPeakPricing.inputPerMillion}</span>
                  <span>Cache: {pricingView.offPeakPricing.cachedInputPerMillion ?? "-"}</span>
                  <span>Out: {pricingView.offPeakPricing.outputPerMillion}</span>
                  <span className="text-[10px] font-sans text-muted-foreground">/ 1M {currency}</span>
                </div>
              </button>
            )}

            {pricingView?.pricing && (
              <button
                type="button"
                onClick={() => onSelectTier("peak")}
                className={cn(
                  "w-full text-left rounded-lg p-2 transition-all border cursor-pointer",
                  activeTierKey === "peak"
                    ? "bg-amber-500/10 border-amber-500/30 text-foreground"
                    : "bg-muted/15 border-border/40 hover:bg-muted/25 text-muted-foreground",
                )}
              >
                <div className="flex items-center justify-between font-medium text-xs">
                  <span className="flex items-center gap-1.5 text-foreground">
                    <span className={cn("h-1.5 w-1.5 rounded-full", isPeakNow ? "bg-amber-400" : "bg-muted-foreground/40")} />
                    Daytime Peak (Base)
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {formatPeakHours(pricingView.peakHours)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between font-mono text-[11px]">
                  <span>In: {pricingView.pricing.inputPerMillion}</span>
                  <span>Cache: {pricingView.pricing.cachedInputPerMillion ?? "-"}</span>
                  <span>Out: {pricingView.pricing.outputPerMillion}</span>
                  <span className="text-[10px] font-sans text-muted-foreground">/ 1M {currency}</span>
                </div>
              </button>
            )}
          </div>

          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Click a rate tier to preview values. Heimdall bills incoming requests automatically by arrival time.
          </p>
        </PopoverContent>
      </Popover>
    );
  }

  if (isTiered && pricingView?.tiers?.length) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20 transition-colors cursor-pointer outline-none"
            onClick={(e) => e.stopPropagation()}
            title="View tiered pricing rules"
          >
            <Layers size={10} className="shrink-0" />
            <span>Tiered · {tierBadge}</span>
            <ChevronDown size={10} className="opacity-70" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-3 text-xs space-y-2.5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
              <Layers size={13} className="text-primary" />
              <span>Tiered Pricing Rules</span>
            </div>
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary border border-primary/20">
              {pricingView.tiers.length} Tiers
            </span>
          </div>

          <div className="space-y-1.5">
            {pricingView.tiers.map((tier, idx) => {
              const isCurrentActive = activeTierKey === String(idx);
              const cond = cleanTierCondition(tier.condition);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onSelectTier(String(idx))}
                  className={cn(
                    "w-full text-left rounded-lg p-2 transition-all border cursor-pointer",
                    isCurrentActive
                      ? "bg-primary/10 border-primary/30 text-foreground"
                      : "bg-muted/15 border-border/40 hover:bg-muted/25 text-muted-foreground",
                  )}
                >
                  <div className="flex items-center justify-between font-medium text-xs">
                    <span className="flex items-center gap-1.5 text-foreground">
                      <span className={cn("h-1.5 w-1.5 rounded-full", isCurrentActive ? "bg-primary" : "bg-muted-foreground/40")} />
                      {cond}
                    </span>
                    {tier.isBase && <span className="text-[10px] text-primary font-medium">Default Base</span>}
                  </div>
                  <div className="mt-1 flex items-center justify-between font-mono text-[11px]">
                    <span>In: {tier.inputPerMillion}</span>
                    <span>Cache: {tier.cachedInputPerMillion ?? "-"}</span>
                    <span>Out: {tier.outputPerMillion}</span>
                    <span className="text-[10px] font-sans text-muted-foreground">/ 1M {currency}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Tiers are for reference. Heimdall estimates cost using the base tier. Click any tier to preview values.
          </p>
        </PopoverContent>
      </Popover>
    );
  }

  return null;
}

function PriceInput({
  label,
  headerRight,
  value,
  onChange,
  numeric = false,
  optional = false,
  readOnly = false,
  unavailable = false,
}: {
  label: React.ReactNode;
  headerRight?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
  optional?: boolean;
  readOnly?: boolean;
  unavailable?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex h-4 items-center justify-between gap-1.5 min-w-0">
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
        {headerRight}
      </div>
      <Input
        value={value}
        inputMode={numeric ? "decimal" : "text"}
        placeholder={unavailable ? "N/A" : optional ? "Same as input" : ""}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        aria-label={typeof label === "string" ? label : undefined}
        className={unavailable ? "border-dashed opacity-55" : undefined}
      />
    </div>
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
  const vscode = model.vscode;

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
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3 pt-0.5">
        <span className="shrink-0 text-[11px] font-semibold text-muted-foreground/70">VS Code</span>
        <div className="h-px flex-1 bg-border/50" />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-3">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Display name</span>
          <Input value={vscode?.name || ""} placeholder={model.id || "Model id"} onChange={(event) => updateVsCode({ name: event.target.value })} />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Context window</span>
          <div className="relative">
            <Input
              value={formatTokenInput(vscode?.contextWindow)}
              inputMode="numeric"
              placeholder="e.g. 128000"
              className="pr-14"
              onChange={(event) => updateVsCode({ contextWindow: event.target.value.replace(/\D/g, "") })}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] text-muted-foreground">tokens</span>
          </div>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Max output tokens</span>
          <div className="relative">
            <Input
              value={formatTokenInput(vscode?.maxOutputTokens)}
              inputMode="numeric"
              placeholder="e.g. 16384"
              className="pr-14"
              onChange={(event) => updateVsCode({ maxOutputTokens: event.target.value.replace(/\D/g, "") })}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] text-muted-foreground">tokens</span>
          </div>
        </label>
      </div>
      <div className="flex flex-wrap items-start gap-x-8 gap-y-2.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Capabilities</span>
          <div className="flex flex-wrap gap-1.5">
            <CapabilityPill
              label="Tool calling"
              active={vscode?.toolCalling === true}
              onClick={() => updateVsCode({ toolCalling: vscode?.toolCalling !== true })}
            />
            <CapabilityPill label="Vision" active={vscode?.vision === true} onClick={() => updateVsCode({ vision: vscode?.vision !== true })} />
            <CapabilityPill
              label="Thinking"
              active={vscode?.thinking === true}
              onClick={() => updateVsCode({ thinking: vscode?.thinking !== true })}
            />
          </div>
        </div>
        <div
          className={cn(
            "flex min-w-0 flex-col gap-1.5 transition-all duration-200 ease-out",
            vscode?.thinking === true
              ? "translate-x-0 opacity-100"
              : "pointer-events-none -translate-x-2.5 opacity-0",
          )}
          aria-hidden={vscode?.thinking !== true}
        >
          <span className="text-xs font-semibold text-muted-foreground">Reasoning effort</span>
          <div className="flex flex-wrap gap-1">
            {REASONING_EFFORT_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => toggleReasoningEffort(level)}
                className={cn(
                  "h-6 rounded-md px-2 text-[11px] transition-colors",
                  vscode?.supportsReasoningEffort?.includes(level)
                    ? "bg-foreground/30 font-semibold text-foreground"
                    : "bg-foreground/[0.05] font-medium text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                )}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTokenInput(raw: string | undefined) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return formatTokenCount(Number(digits));
}

function vscodeSummaryContext(model: VendorModelDraft): string | null {
  const raw = String(model.vscode?.contextWindow || "").replace(/\D/g, "");
  return raw ? `${formatCompactTokenCount(Number(raw))} ctx` : null;
}

function vscodeSummaryCapabilities(model: VendorModelDraft): string[] {
  const vscode = model.vscode;
  const items: string[] = [];
  if (vscode?.toolCalling === true) {
    items.push("Tools");
  }
  if (vscode?.vision === true) {
    items.push("Vision");
  }
  if (vscode?.thinking === true) {
    items.push("Thinking");
  }
  return items;
}

function CapabilityPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-6 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
        active
          ? "border-primary/45 bg-primary/15 text-primary"
          : "border-border bg-background/40 text-muted-foreground hover:border-foreground/25 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
