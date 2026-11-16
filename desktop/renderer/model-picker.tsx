import { codexModel, providerPresets, protocols } from "../shared/providers";
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
          aria-label="选择模型"
          aria-disabled={disabled}
          onClick={(e) => {
            if (disabled) e.preventDefault();
          }}
        >
          <span className="model-picker-label" title={current?.name}>
            {current?.name || (models.length ? "选择模型" : "正在加载模型…")}
          </span>
          <ChevronDown size={14} />
        </summary>
        <div className="context-popover model-popover">
          <input
            aria-label="搜索模型"
            placeholder="搜索模型…"
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
                      {model.vision ? " · 支持图片" : " · 文本"}
                    </small>
                  </span>
                  {model.id === value && <Check size={15} />}
                </button>
                {model.id !== codexModel.id &&
                  model.connection !== "copilot" && (
                    <button
                      disabled={disabled}
                      aria-label={`配置 ${model.name}`}
                      onClick={() => edit(model)}
                    >
                      ···
                    </button>
                  )}
              </div>
            ))}
          <button
            disabled={disabled || busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              setEditing(undefined);
              try {
                accept(await window.anvil.copilotModels());
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "正在获取 Copilot 模型…" : "获取 / 刷新 Copilot 模型"}
          </button>
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
            <Plus size={15} /> 添加模型…
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
              <h2>模型设置</h2>
              <button
                type="button"
                aria-label="关闭模型设置"
                disabled={busy}
                onClick={() => {
                  dialog.current?.close();
                  setEditing(undefined);
                }}
              >
                <X size={18} />
              </button>
            </header>
            <p>通过 OpenCode 供应商适配器连接，密钥保存在 Keygrant 中。</p>
            <label>
              供应商预设
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
                <option value="">选择供应商，或在下方手动配置…</option>
                {providerPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              API 协议
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
                ["name", "显示名称"],
                ["provider", "供应商名称"],
                ["model", "模型 ID"],
                ["endpoint", "HTTPS API 基础地址（或对应接口地址）"],
                ["keyRef", "Keygrant 环境变量名"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  required={key !== "endpoint" || editing.id !== "ark-default"}
                  value={editing[key]}
                  placeholder={
                    key === "endpoint" && editing.id === "ark-default"
                      ? "使用已注入的 BYTEPLUS_ARK_RESPONSES_URL"
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
              此模型支持图片输入
            </label>
            <label className="model-capability">
              <input
                type="checkbox"
                checked={editing.tools !== false}
                onChange={(e) =>
                  setEditing({ ...editing, tools: e.target.checked })
                }
              />
              此模型支持工具调用
            </label>
            <p>
              留空时按供应商和模型选择默认值；未知模型使用 64K 上下文、4K
              输出预算。手动填写会覆盖默认值。当前 OpenCode 单次输出另有约 32K
              上限。
            </p>
            <div className="model-limits">
              {(["contextLimit", "outputLimit"] as const).map((field) => (
                <label key={field}>
                  {field === "contextLimit"
                    ? "上下文 Token 上限"
                    : "输出 Token 预算"}
                  <input
                    type="number"
                    min={256}
                    max={10000000}
                    placeholder="留空自动选择"
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
              启动 Anvil 时通过 Keygrant
              注入对应密钥。新增密钥名称后需要重启；仅在供应商支持时启用图片功能。
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
                  models.filter((m) => m.id !== codexModel.id).length < 2 ||
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
                移除
              </button>
              <button
                type="button"
                disabled={busy}
                title="保存配置并发送一次少量计费的测试请求"
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  setStatus("");
                  try {
                    accept(await window.anvil.saveModel(editing));
                    await window.anvil.testModel(editing.id);
                    setStatus("连接成功");
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                保存并测试连接
              </button>
              <button disabled={busy} type="submit">
                {busy ? "处理中…" : "保存"}
              </button>
            </footer>
          </form>
        )}
      </dialog>
    </>
  );
}
