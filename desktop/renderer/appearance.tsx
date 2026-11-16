import { useState, useSyncExternalStore } from "react";
import {
  appearanceFields,
  normalizeAppearance,
  type Appearance,
  type AppearanceKey,
} from "../shared/appearance";

const storageKey = "anvil:appearance:v1";
let current = normalizeAppearance(null);
try {
  current = normalizeAppearance(
    JSON.parse(localStorage.getItem(storageKey) || "null"),
  );
} catch {}
const listeners = new Set<() => void>();
export const getAppearance = () => current;
export function subscribeAppearance(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function apply() {
  const style = document.documentElement.style;
  style.setProperty("--ui-font-size", `${current.uiFontSize}px`);
  style.setProperty("--chat-font-size", `${current.chatFontSize}px`);
  style.setProperty("--code-font-size", `${current.codeFontSize}px`);
  style.setProperty("--chat-line-height", String(current.chatLineHeight));
}
apply();
function save(value: Appearance) {
  const next = normalizeAppearance(value);
  localStorage.setItem(storageKey, JSON.stringify(next));
  current = next;
  apply();
  listeners.forEach((listener) => listener());
}
export function AppearanceSettings() {
  const value = useSyncExternalStore(subscribeAppearance, getAppearance);
  const [error, setError] = useState("");
  function update(next: Appearance) {
    try {
      save(next);
      setError("");
    } catch {
      setError("无法保存外观设置，请检查本机存储空间后重试。");
    }
  }
  return (
    <>
      <h2>外观</h2>
      <p className="settings-note">
        调整后立即生效，自动保存在本机，不参与账号同步。
      </p>
      {(Object.keys(appearanceFields) as AppearanceKey[]).map((key) => {
        const field = appearanceFields[key];
        return (
          <div className="settings-row" key={key}>
            <label htmlFor={`appearance-${key}`}>{field.label}</label>
            <div className="appearance-control">
              <input
                id={`appearance-${key}`}
                type="range"
                min={field.min}
                max={field.max}
                step={field.step}
                value={value[key]}
                onChange={(event) =>
                  update({ ...value, [key]: Number(event.target.value) })
                }
              />
              <output htmlFor={`appearance-${key}`}>
                {value[key]}
                {key === "chatLineHeight" ? " 倍" : "px"}
              </output>
            </div>
          </div>
        );
      })}
      <div className="appearance-preview">
        <p>聊天预览：让代码和思路都清晰可读。</p>
        <code>const greeting = "Hello, Anvil";</code>
      </div>
      <button onClick={() => update(normalizeAppearance(null))}>
        恢复默认值
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
