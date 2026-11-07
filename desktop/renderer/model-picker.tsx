import { providerPresets, protocols } from "../shared/providers";
import { accountScope } from "./account";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, X, Plus, Check } from "lucide-react";
import type { ModelProfile } from "../shared/api";
export function ModelPicker({
  value,
  onChange,
  disabled,
  onModels,
  openRequest = 0,
}: {
  openRequest?: number;
  value: string;
  onChange(id: string): void;
  disabled: boolean;
  onModels(models: ModelProfile[]): void;
}) {
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem("anvil:recent-models:" + accountScope) || "[]",
      );
      return Array.isArray(value)
        ? value.filter((id) => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  });
  function choose(id: string) {
    onChange(id);
    const next = [id, ...recent.filter((item) => item !== id)].slice(0, 8);
    setRecent(next);
    try {
      localStorage.setItem(
        "anvil:recent-models:" + accountScope,
        JSON.stringify(next),
      );
    } catch {}
  }

  const [editing, setEditing] = useState<ModelProfile>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (openRequest && menu.current) {
      menu.current.open = true;
      menu.current.querySelector<HTMLInputElement>("input")?.focus();
    }
  }, [openRequest]);
  function accept(items: ModelProfile[]) {
    setModels(items);
    onModels(items);
  }
  useEffect(() => {
    const reload = () =>
      void window.anvil
        .models()
        .then(accept)
        .catch((e) => setError(String(e)));
    reload();
    return window.anvil.onAccountChange(reload);
  }, []);
  function edit(profile: ModelProfile) {
    setEditing({ ...profile });
    setError("");
    setStatus("");
    menu.current?.removeAttribute("open");
    dialog.current?.showModal();
  }
  async function save() {
    if (!editing) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      accept(await window.anvil.saveModel(editing));
      choose(editing.id);
      dialog.current?.close();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const current = models.find((m) => m.id === value);
  return (
    <>
      <details className="tools-menu composer-menu model-picker" ref={menu}>
        <summary
          aria-label="Choose model"
          aria-disabled={disabled}
          onClick={(e) => {
            if (disabled) e.preventDefault();
          }}
        >
          <span className="model-picker-label" title={current?.name}>
            {current?.name ||
              (models.length ? "Choose model" : "Loading models…")}
          </span>
          <ChevronDown size={14} />
        </summary>
        <div className="context-popover model-popover">
          <input
            aria-label="Search models"
            placeholder="Search models…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {[...models]
            .sort(
              (a, b) =>
                (recent.indexOf(a.id) < 0 ? 99 : recent.indexOf(a.id)) -
                (recent.indexOf(b.id) < 0 ? 99 : recent.indexOf(b.id)),
            )
            .filter((m) =>
              `${m.name} ${m.provider} ${m.model}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((model) => (
              <div className="model-option" key={model.id}>
                <button
                  disabled={disabled}
                  onClick={() => {
                    choose(model.id);
                    menu.current?.removeAttribute("open");
                  }}
                >
                  <span>
                    {model.name}
                    <small>
                      {model.provider}
                      {model.vision ? " · Images" : " · Text"}
                    </small>
                  </span>
                  {model.id === value && <Check size={15} />}
                </button>
                <button
                  disabled={disabled}
                  aria-label={`Configure ${model.name}`}
                  onClick={() => edit(model)}
                >
                  ···
                </button>
              </div>
            ))}
          <button
            disabled={disabled}
            onClick={() =>
              edit({
                id: crypto.randomUUID(),
                name: "",
                provider: "",
                model: "",
                endpoint: "",
                keyRef: "BYTEPLUS_ARK_API_KEY",
                vision: false,
              })
            }
          >
            <Plus size={15} /> Add model…
          </button>
          {error && !editing && <p role="alert">{error}</p>}
        </div>
      </details>
      <dialog
        className="model-dialog"
        ref={dialog}
        onCancel={() => {
          if (busy) return;
          setEditing(undefined);
        }}
      >
        {editing && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <header>
              <h2>Model settings</h2>
              <button
                type="button"
                aria-label="Close model settings"
                disabled={busy}
                onClick={() => {
                  dialog.current?.close();
                  setEditing(undefined);
                }}
              >
                <X size={18} />
              </button>
            </header>
            <p>
              Connect through OpenCode’s provider adapters. Credentials stay in
              Keygrant.
            </p>
            <label>
              Provider preset
              <select
                value=""
                onChange={(e) => {
                  const preset = providerPresets.find(
                    (p) => p.id === e.target.value,
                  );
                  if (preset) {
                    setEditing({
                      ...editing,
                      provider: preset.name,
                      protocol: preset.protocol,
                      endpoint: preset.endpoint,
                      keyRef: preset.keyRef,
                      model: "",
                      name: "",
                      vision: false,
                    });
                    setStatus("");
                  }
                }}
              >
                <option value="">Choose a provider or configure below…</option>
                {providerPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              API protocol
              <select
                value={editing.protocol || "responses"}
                onChange={(e) => {
                  setEditing({
                    ...editing,
                    protocol: e.target.value as (typeof protocols)[number],
                  });
                  setStatus("");
                }}
              >
                <option value="responses">OpenAI Responses</option>
                <option value="chat-completions">
                  OpenAI-compatible Chat Completions
                </option>
                <option value="anthropic">Anthropic Messages</option>
                <option value="google">Google Gemini</option>
              </select>
            </label>
            {(
              [
                ["name", "Display name"],
                ["provider", "Provider name"],
                ["model", "Model ID"],
                ["endpoint", "HTTPS API base URL (or matching endpoint)"],
                ["keyRef", "Keygrant environment variable"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  required={key !== "endpoint" || editing.id !== "ark-default"}
                  value={editing[key]}
                  placeholder={
                    key === "endpoint" && editing.id === "ark-default"
                      ? "Use injected BYTEPLUS_ARK_RESPONSES_URL"
                      : undefined
                  }
                  onChange={(e) => {
                    setEditing({ ...editing, [key]: e.target.value });
                    setStatus("");
                  }}
                />
              </label>
            ))}
            <label className="model-capability">
              <input
                type="checkbox"
                checked={editing.vision}
                onChange={(e) =>
                  setEditing({ ...editing, vision: e.target.checked })
                }
              />{" "}
              This model supports image input
            </label>
            <label className="model-capability">
              <input
                type="checkbox"
                checked={editing.tools !== false}
                onChange={(e) =>
                  setEditing({ ...editing, tools: e.target.checked })
                }
              />
              This model supports tool calling
            </label>
            <div className="model-limits">
              {(["contextLimit", "outputLimit"] as const).map((field) => (
                <label key={field}>
                  {field === "contextLimit"
                    ? "Context tokens"
                    : "Maximum output tokens"}
                  <input
                    type="number"
                    min={256}
                    max={10000000}
                    placeholder={field === "contextLimit" ? "65536" : "4096"}
                    value={editing[field] ?? ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        [field]: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <p>
              Inject the named secret through Keygrant when starting Anvil. New
              secret names require a restart. Enable images only if supported by
              the provider.
            </p>
            {error && (
              <p role="alert" className="model-error">
                {error}
              </p>
            )}
            {status && <p role="status">{status}</p>}
            <footer>
              <button
                type="button"
                disabled={
                  busy ||
                  models.length < 2 ||
                  !models.some((m) => m.id === editing.id)
                }
                onClick={async () => {
                  setBusy(true);
                  try {
                    const next = await window.anvil.deleteModel(editing.id);
                    accept(next);
                    if (value === editing.id) onChange(next[0].id);
                    dialog.current?.close();
                    setEditing(undefined);
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Remove
              </button>
              <button
                type="button"
                disabled={busy}
                title="Saves this configuration and sends a small billable test request"
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  setStatus("");
                  try {
                    accept(await window.anvil.saveModel(editing));
                    await window.anvil.testModel(editing.id);
                    setStatus("Connection successful");
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Save & test connection
              </button>
              <button disabled={busy} type="submit">
                {busy ? "Working…" : "Save"}
              </button>
            </footer>
          </form>
        )}
      </dialog>
    </>
  );
}
