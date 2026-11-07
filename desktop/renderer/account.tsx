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
          <h2>Your coding workspace, on every computer.</h2>
          <p>
            Sign in to sync model settings and groups.
            <br />
            Chats, files and folder permissions stay on this device.
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
            {state?.pending
              ? "Waiting for Google sign-in…"
              : "Continue with Google"}
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
              Open sign-in again
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
        title="Account"
        aria-label="Account menu"
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
          aria-label="Account"
        >
          <div className="account-menu-identity">
            <span className="account-avatar">{initial}</span>
            <div>
              <strong>{state.user.name || "Anvil account"}</strong>
              <span>{state.user.email}</span>
            </div>
          </div>
          <div className="account-menu-divider" />
          <button role="menuitem" onClick={() => showSettings("account")}>
            <UserRound size={19} />
            <span>My account</span>
          </button>
          <button role="menuitem" onClick={() => showSettings()}>
            <Settings size={19} />
            <span>Settings</span>
            <kbd>Ctrl+,</kbd>
          </button>
          <div className="account-menu-divider" />
          <button role="menuitem" disabled={busy} onClick={() => void logout()}>
            <LogOut size={19} />
            <span>{busy ? "Please wait…" : "Sign out"}</span>
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
            <h2 id="settings-title">Settings</h2>
            <nav aria-label="Settings sections">
              {[
                { id: "general", label: "General", icon: SlidersHorizontal },
                { id: "account", label: "Account", icon: UserRound },
                { id: "devices", label: "Devices", icon: Monitor },
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
              aria-label="Close settings"
              onClick={() => setOpen(false)}
            >
              <X size={20} />
            </button>
            {section === "general" && (
              <>
                <h2>General</h2>
                <div className="settings-row">
                  <div>
                    <label htmlFor="default-model">Default model</label>
                    <p>Used for new chats.</p>
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
                    <strong>Sync settings</strong>
                    <p>Your preferences sync across devices.</p>
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
                    {busy ? "Working…" : "Sync now"}
                  </button>
                </div>
                <p className="settings-note">
                  Chats, attachments and folder permissions stay on this
                  computer.
                </p>
              </>
            )}
            {section === "account" && (
              <>
                <h2>Account</h2>
                <div className="settings-profile">
                  <span className="account-avatar">{initial}</span>
                  <div>
                    <strong>{state.user.name}</strong>
                    <p>{state.user.email}</p>
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <strong>Sign-in method</strong>
                    <p>Google</p>
                  </div>
                  <img src={googleLogo} width={20} height={20} alt="Google" />
                </div>
                <div className="settings-row">
                  <div>
                    <strong>Sign out of Anvil</strong>
                    <p>Your local chats will be kept.</p>
                  </div>
                  <button disabled={busy} onClick={() => void logout()}>
                    <LogOut size={16} />
                    Sign out
                  </button>
                </div>
              </>
            )}
            {section === "devices" && (
              <>
                <h2>Devices</h2>
                <p className="settings-note">
                  Manage where you are signed in to Anvil.
                </p>
                {devices.length === 0 && (
                  <p>{busy ? "Loading devices…" : "No devices to display."}</p>
                )}
                {devices.map((d) => (
                  <div className="settings-row" key={d.id}>
                    <div className="settings-device">
                      <Monitor size={20} />
                      <div>
                        <strong>{d.device}</strong>
                        <p>
                          {d.current
                            ? "This device"
                            : "Signed in " +
                              new Date(d.created).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    {d.current ? (
                      <span className="device-current">Current</span>
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
                        Sign out
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
