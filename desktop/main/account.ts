import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type {
  AccountState,
  AccountUser,
  CloudConfig,
  AccountDevice,
} from "../shared/api";
export const CLOUD_URL = "https://anvil.keygrant.app";
export class Account {
  user: AccountUser | null = null;
  snapshot?: { revision: number; config: CloudConfig };
  private token = "";
  private checked = 0;
  private pending?: { id: string; verifier: string; expires: number };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private root: string,
    private encrypt: (value: string) => Buffer,
    private decrypt: (value: Buffer) => string,
  ) {
    try {
      this.token = this.decrypt(
        readFileSync(path.join(root, "account.session")),
      );
    } catch {}
  }
  get hasSession() {
    return !!this.token;
  }
  state(): AccountState {
    return {
      user: this.user,
      revision: this.snapshot?.revision || 0,
      config: this.snapshot?.config,
      pending: !!this.pending,
    };
  }
  private async request<T>(
    route: string,
    method = "GET",
    data?: unknown,
    anonymous = false,
  ): Promise<T> {
    const response = await fetch(CLOUD_URL + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(!anonymous && this.token
          ? { Authorization: `Bearer ${this.token}` }
          : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 401 && !anonymous) {
      this.clear();
      throw new Error("Your session expired. Sign in again.");
    }
    if (response.status === 409)
      throw new Error(
        "Settings changed on another device. Click Refresh settings, then try again. Your change was not saved.",
      );
    if (!response.ok)
      throw new Error(`Account service error (${response.status}). Try again.`);
    return (await response.json()) as T;
  }
  async require() {
    if (!this.token) throw new Error("Sign in to Anvil first.");
    if (!this.user || Date.now() - this.checked > 30000) {
      this.user = await this.request<AccountUser>("/me");
      this.checked = Date.now();
    }
    return this.user;
  }
  async begin() {
    const verifier = randomBytes(32).toString("base64url");
    const result = await this.request<{
      id: string;
      url: string;
      expires: number;
    }>(
      "/auth/start",
      "POST",
      {
        challenge: createHash("sha256").update(verifier).digest("base64url"),
        device: os.hostname().slice(0, 100),
      },
      true,
    );
    const url = new URL(result.url);
    if (url.origin !== CLOUD_URL || url.pathname !== "/auth/authorize")
      throw new Error("Invalid login address.");
    this.pending = { id: result.id, verifier, expires: result.expires };
    return result.url;
  }
  async poll() {
    if (!this.pending) return false;
    if (Date.now() > this.pending.expires) {
      this.pending = undefined;
      throw new Error("Login timed out. Try again.");
    }
    const result = await this.request<{ token?: string; pending?: boolean }>(
      "/auth/exchange",
      "POST",
      { id: this.pending.id, verifier: this.pending.verifier },
      true,
    );
    if (!result.token) return false;
    try {
      const encrypted = this.encrypt(result.token);
      mkdirSync(this.root, { recursive: true });
      writeFileSync(path.join(this.root, "account.session"), encrypted);
      this.token = result.token;
      this.pending = undefined;
      await this.require();
    } catch (error) {
      this.clear();
      throw error;
    }
    return true;
  }
  async refresh() {
    await this.require();
    this.snapshot = await this.request("/config");
    return this.state();
  }
  async mutate(change: (config: CloudConfig) => CloudConfig) {
    const action = this.queue
      .catch(() => {})
      .then(async () => {
        await this.require();
        if (!this.snapshot) await this.refresh();
        const base = this.snapshot!;
        const config = change(structuredClone(base.config));
        this.snapshot = await this.request("/config", "PUT", {
          revision: base.revision,
          config,
        });
        return this.state();
      });
    this.queue = action;
    return action;
  }
  async devices() {
    await this.require();
    return this.request<AccountDevice[]>("/devices");
  }
  async revoke(id: string) {
    await this.require();
    await this.request("/devices/" + encodeURIComponent(id), "DELETE");
  }
  async logout() {
    await this.queue.catch(() => {});
    try {
      if (this.token) await this.request("/logout", "POST");
    } finally {
      this.clear();
    }
  }
  clear() {
    this.token = "";
    this.user = null;
    this.snapshot = undefined;
    this.pending = undefined;
    this.checked = 0;
    rmSync(path.join(this.root, "account.session"), { force: true });
  }
}
