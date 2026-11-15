import googleLogo from "./google-logo.png";
import { useEffect, useState, useRef, type ReactNode } from "react";
import {
  UserRound,
  X,
  Settings,
  LogOut,
  Monitor,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import type { AccountState, AccountDevice } from "../shared/api";
export let accountScope = "";
export let defaultModelID = "ark-default";
export function AccountGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccountState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [section, setSection] = useState("general");
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLDialogElement>(null);
  function showSettings(tab = "general") {
    setMenuOpen(false);
    setSection(tab);
    setOpen(true);
  }
  async function logout() {
    await action(async () => {
      await window.anvil.accountLogout();
      const next = await window.anvil.accountStatus();
      accept(next);
      if (!next.user) {
        setOpen(false);
        setMenuOpen(false);
      }
    });
  }
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (e: PointerEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      )
        setMenuOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const buttons = Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) || [],
        );
        if (!buttons.length) return;
        e.preventDefault();
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[
          (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length
        ]?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [menuOpen]);
  useEffect(() => {
    if (open) {
      settingsRef.current?.showModal();
      void action(async () => setDevices(await window.anvil.accountDevices()));
    } else settingsRef.current?.close();
  }, [open]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "," && state?.user) {
        e.preventDefault();
        showSettings();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [state?.user]);
  const [devices, setDevices] = useState<AccountDevice[]>([]);
  function accept(next: AccountState) {
    accountScope = next.user?.id || "";
    defaultModelID = next.config?.preferences.defaultModelID || "ark-default";
    setState(next);
  }
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let live = true,
      checking = false;
    const check = async (refresh = false) => {
      if (checking) return;
      checking = true;
      try {
        const next = await window.anvil.accountStatus(refresh);
        if (live) accept(next);
      } catch (e) {
        if (live) setError(String(e));
      } finally {
        checking = false;
      }
    };
    void check();
    const off = window.anvil.onAccountChange(() => void check());
    const timer = setInterval(() => void check(true), 60000);
    return () => {
      live = false;
      off();
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!state?.pending) return;
    let live = true,
      polling = false;
    const timer = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const next = await window.anvil.accountPoll();
        if (live) {
          accept(next);
          setError("");
        }
      } catch (e) {
        if (live) {
          setError(String(e));
          setState((s) => (s ? { ...s, pending: false } : s));
        }
      } finally {
        polling = false;
      }
    }, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [state?.pending]);
  if (!state?.user || !state.config)
    return (
      <div className="account-login">
        <div className="account-titlebar" />
        <section>
          <h1>Anvil</h1>
          <h2>在每台电脑上继续你的编程工作。</h2>
          <p>
            登录后同步模型设置和分组。
            <br />
            聊天、文件和目录权限保存在本机。
          </p>
          <button
            className="google-sign-in"
            disabled={busy || state?.pending}
            onClick={() =>
              void action(async () => {
                await window.anvil.accountLogin();
                accept(await window.anvil.accountStatus());
              })
            }
          >
            <img
              src={googleLogo}
              width={20}
              height={20}
              alt=""
              aria-hidden="true"
            />
            {state?.pending ? "等待 Google 登录…" : "使用 Google 登录"}
          </button>
          {state?.pending && (
            <button
              onClick={() =>
                void action(async () => {
                  await window.anvil.accountLogin();
                  accept(await window.anvil.accountStatus());
                })
              }
            >
              重新打开登录页面
            </button>
          )}
          {error && (
            <p role="alert" className="account-error">
              {error}
            </p>
          )}
        </section>
      </div>
    );
  const initial = (state.user.name || state.user.email)
    .trim()
    .slice(0, 1)
    .toUpperCase();
  return (
    <>
      <div key={state.user.id}>{children}</div>
      <button
        ref={triggerRef}
        className="account-trigger"
        title="账号"
        aria-label="账号菜单"
        aria-expanded={menuOpen}
        aria-controls="account-menu"
        aria-haspopup="menu"
        onClick={() => setMenuOpen((v) => !v)}
      >
        <span className="account-avatar">{initial}</span>
      </button>
      {menuOpen && (
        <div
          ref={menuRef}
          id="account-menu"
          className="account-menu"
          role="menu"
          aria-label="账号"
        >
          <div className="account-menu-identity">
            <span className="account-avatar">{initial}</span>
            <div>
              <strong>{state.user.name || "Anvil 账号"}</strong>
              <span>{state.user.email}</span>
            </div>
          </div>
          <div className="account-menu-divider" />
          <button role="menuitem" onClick={() => showSettings("account")}>
            <UserRound size={19} />
            <span>我的账号</span>
          </button>
          <button role="menuitem" onClick={() => showSettings()}>
            <Settings size={19} />
            <span>设置</span>
            <kbd>Ctrl+,</kbd>
          </button>
          <div className="account-menu-divider" />
          <button role="menuitem" disabled={busy} onClick={() => void logout()}>
            <LogOut size={19} />
            <span>{busy ? "请稍候…" : "退出登录"}</span>
          </button>
          {error && (
            <p role="alert" className="account-error">
              {error}
            </p>
          )}
        </div>
      )}
      <dialog
        ref={settingsRef}
        className="account-settings"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
        aria-labelledby="settings-title"
      >
        <div className="settings-layout">
          <aside className="settings-nav">
            <h2 id="settings-title">设置</h2>
            <nav aria-label="设置分类">
              {[
                { id: "general", label: "通用", icon: SlidersHorizontal },
                { id: "account", label: "账号", icon: UserRound },
                { id: "devices", label: "设备", icon: Monitor },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  aria-current={section === id ? "page" : undefined}
                  className={section === id ? "active" : ""}
                  onClick={() => setSection(id)}
                >
                  <Icon size={18} />
                  {label}
                </button>
              ))}
            </nav>
          </aside>
          <div className="settings-content">
            <button
              className="icon-button account-close"
              aria-label="关闭设置"
              onClick={() => setOpen(false)}
            >
              <X size={20} />
            </button>
            {section === "general" && (
              <>
                <h2>通用</h2>
                <div className="settings-row">
                  <div>
                    <label htmlFor="default-model">默认模型</label>
                    <p>用于新聊天。</p>
                  </div>
                  <select
                    id="default-model"
                    disabled={busy}
                    value={state.config.preferences.defaultModelID}
                    onChange={(e) =>
                      void action(async () =>
                        accept(
                          await window.anvil.setDefaultModel(e.target.value),
                        ),
                      )
                    }
                  >
                    {state.config.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-row">
                  <div>
                    <strong>同步设置</strong>
                    <p>在不同设备间同步偏好设置。</p>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () =>
                        accept(await window.anvil.accountStatus(true)),
                      )
                    }
                  >
                    <RefreshCw size={16} />
                    {busy ? "处理中…" : "立即同步"}
                  </button>
                </div>
                <p className="settings-note">
                  聊天、附件和目录权限保存在本机。
                </p>
              </>
            )}
            {section === "account" && (
              <>
                <h2>账号</h2>
                <div className="settings-profile">
                  <span className="account-avatar">{initial}</span>
                  <div>
                    <strong>{state.user.name}</strong>
                    <p>{state.user.email}</p>
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <strong>登录方式</strong>
                    <p>Google</p>
                  </div>
                  <img src={googleLogo} width={20} height={20} alt="Google" />
                </div>
                <div className="settings-row">
                  <div>
                    <strong>退出 Anvil</strong>
                    <p>本地聊天记录会保留。</p>
                  </div>
                  <button disabled={busy} onClick={() => void logout()}>
                    <LogOut size={16} />
                    退出登录
                  </button>
                </div>
              </>
            )}
            {section === "devices" && (
              <>
                <h2>设备</h2>
                <p className="settings-note">管理已登录 Anvil 的设备。</p>
                {devices.length === 0 && (
                  <p>{busy ? "正在加载设备…" : "暂无设备。"}</p>
                )}
                {devices.map((d) => (
                  <div className="settings-row" key={d.id}>
                    <div className="settings-device">
                      <Monitor size={20} />
                      <div>
                        <strong>{d.device}</strong>
                        <p>
                          {d.current
                            ? "本机"
                            : "登录于 " +
                              new Date(d.created).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    {d.current ? (
                      <span className="device-current">当前设备</span>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await window.anvil.revokeDevice(d.id);
                            setDevices(await window.anvil.accountDevices());
                          })
                        }
                      >
                        退出登录
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}
            {error && (
              <p role="alert" className="account-error">
                {error}
              </p>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
