import { useEffect, useState } from "react";
import { Blocks, Cable, FileText, Plus, Search } from "lucide-react";
import {
  defaultExtensions,
  githubKey,
  loginPattern,
  type Binding,
  type Extensions,
} from "../shared/extensions";

const catalog = [
  {
    id: "pr-review",
    name: "PR 审查",
    kind: "插件",
    description: "一起启用 GitHub MCP 和 /review-pr，审查当前仓库的拉取请求。",
    terms: "pull request",
  },
  {
    id: "github",
    name: "GitHub",
    kind: "MCP",
    description: "读取绑定仓库的 PR、提交版本和变更文件。",
    terms: "read_pull_request pull request",
  },
  {
    id: "review-pr",
    name: "/review-pr",
    kind: "Skill",
    description: "输入 PR 编号，读取变更并审查代码。",
    terms: "pull request review",
  },
  {
    id: "playwright",
    name: "Playwright",
    kind: "MCP",
    description: "用独立的 Chrome 会话检查页面、交互和截图。",
    terms: "browser snapshot screenshot",
  },
];
export function useExtensions() {
  const [state, setState] = useState<{
    config: Extensions;
    revision: number;
  }>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!window.anvil.accountStatus) return;
    let live = true;
    async function read() {
      try {
        const s = await window.anvil.accountStatus();
        if (live && s.config)
          setState((old) =>
            old && old.revision > s.revision
              ? old
              : {
                  config: s.config!.extensions || defaultExtensions,
                  revision: s.revision,
                },
          );
      } catch (e) {
        if (live) setError(String(e));
      }
    }
    void read();
    const off = window.anvil.onAccountChange(() => void read());
    return () => {
      live = false;
      off();
    };
  }, []);
  return {
    state,
    error,
    setError,
    async reload() {
      const s = await window.anvil.accountStatus(true);
      if (s.config)
        setState({
          config: s.config.extensions || defaultExtensions,
          revision: s.revision,
        });
    },
  };
}
type Library = ReturnType<typeof useExtensions>;
export function ExtensionsPage({
  library,
  reviewAvailable,
  folder,
  managed,
  onUse,
}: {
  library: Library;
  reviewAvailable: boolean;
  folder?: string;
  managed: boolean;
  onUse: (id: string) => void;
}) {
  const config = library.state?.config || defaultExtensions;
  const [importOpen, setImportOpen] = useState(false);
  const [source, setSource] = useState("");
  const [filter, setFilter] = useState("全部");
  const [search, setSearch] = useState("");
  const [selected, select] = useState("pr-review");
  const [repo, setRepo] = useState<string | null>(null);
  const [identity, setIdentity] = useState<string | null>(null);
  const [login, setLogin] = useState("");
  const [auth, setAuth] = useState<Binding["auth"]>("cli");
  const [busy, setBusy] = useState(false);
  const [deviceCheck, setDeviceCheck] = useState(0);
  const [chrome, setChrome] = useState(false);
  useEffect(() => {
    let live = true;
    setRepo(null);
    if (folder)
      window.anvil
        .extensionRepo(folder)
        .then((r) => {
          if (live) setRepo(r);
        })
        .catch((e) => {
          if (live) library.setError(String(e));
        });
    return () => {
      live = false;
    };
  }, [folder]);
  useEffect(() => {
    let live = true;
    if (selected === "github")
      window.anvil
        .githubIdentity()
        .then((r) => {
          if (live) setIdentity(r);
        })
        .catch(() => {
          if (live) setIdentity(null);
        });
    if (selected === "playwright")
      window.anvil
        .browserAvailable()
        .then((r) => {
          if (live) setChrome(r);
        })
        .catch(() => {
          if (live) setChrome(false);
        });
    return () => {
      live = false;
    };
  }, [selected, deviceCheck]);
  const binding = config.bindings.find((b) => b.repo === repo);
  useEffect(() => {
    setLogin(binding?.login || "");
    setAuth(binding?.auth || "cli");
  }, [repo, binding?.login, binding?.auth]);
  const rows = [
    ...catalog,
    ...config.skills.map((s) => ({
      id: s.id,
      name: "/" + s.id,
      kind: "Skill",
      description: s.files.map((f) => f.path).join(", "),
      terms: "",
    })),
  ];
  function enabled(id: string) {
    if (id === "pr-review")
      return (
        config.enabled.includes("github") &&
        config.enabled.includes("review-pr")
      );
    return (
      config.enabled.some((e) => e === id) ||
      !!config.skills.find((s) => s.id === id)?.enabled
    );
  }
  const visible = rows
    .filter(
      (r) =>
        (filter === "全部" || r.kind === filter) &&
        (r.name + " " + r.id + " " + r.terms)
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    )
    .sort((a, b) => Number(enabled(b.id)) - Number(enabled(a.id)));
  const row = visible.find((r) => r.id === selected) || visible[0];
  // Filtering can select a new detail row without a pointer click.
  useEffect(() => {
    if (row && row.id !== selected) select(row.id);
  }, [row?.id, selected]);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    library.setError("");
    try {
      await fn();
    } catch (e) {
      library.setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function save(next: Extensions) {
    if (!library.state) return;
    void act(() => window.anvil.saveExtensions(next, library.state!.revision));
  }
  function toggle(id: string) {
    const skill = config.skills.find((s) => s.id === id);
    if (skill)
      return save({
        ...config,
        skills: config.skills.map((s) =>
          s.id === id ? { ...s, enabled: !s.enabled } : s,
        ),
      });
    const ids = id === "pr-review" ? ["github", "review-pr"] : [id];
    const next = config.enabled.filter((k) => !ids.includes(k));
    if (!enabled(id)) next.push(...(ids as typeof next));
    save({ ...config, enabled: next });
  }
  return (
    <section className="extensions-page" aria-label="扩展">
      <header>
        <h1>扩展</h1>
        <button
          disabled={busy || !library.state}
          aria-expanded={importOpen}
          onClick={() => setImportOpen(!importOpen)}
        >
          <Plus size={16} /> 导入 Skill
        </button>
      </header>
      {importOpen && (
        <div className="extension-import">
          <button
            disabled={busy}
            onClick={() =>
              void act(() => window.anvil.importSkill(library.state!.revision))
            }
          >
            选择本地目录…
          </button>
          <label>
            GitHub 固定版本链接
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="https://github.com/owner/repo/tree/提交/目录"
            />
          </label>
          <button
            disabled={!source.trim() || busy}
            onClick={() =>
              void act(() =>
                window.anvil.importSkill(
                  library.state!.revision,
                  source.trim(),
                ),
              )
            }
          >
            从 GitHub 导入
          </button>
        </div>
      )}
      <div className="extensions-columns">
        <aside>
          <label className="extension-search">
            <Search size={15} />
            <input
              aria-label="搜索扩展"
              placeholder="搜索扩展或工具"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="extension-filters">
            {["全部", "MCP", "Skill", "插件"].map((f) => (
              <button
                key={f}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          {visible.map((r) => (
            <button
              key={r.id}
              className="extension-row"
              aria-pressed={row?.id === r.id}
              onClick={() => select(r.id)}
            >
              {r.kind === "MCP" ? (
                <Cable size={17} />
              ) : r.kind === "插件" ? (
                <Blocks size={17} />
              ) : (
                <FileText size={17} />
              )}{" "}
              <span>
                {r.name}
                <small>
                  {r.kind} · {enabled(r.id) ? "已启用" : "未启用"}
                </small>
              </span>
            </button>
          ))}
          {!visible.length && <p>没有匹配的扩展</p>}
        </aside>
        <article>
          {row && (
            <>
              <small>
                {row.kind} ·{" "}
                {config.skills.some((s) => s.id === row.id)
                  ? "账号导入"
                  : "Anvil 内置"}
              </small>
              <h2>{row.name}</h2>
              <p>{row.description}</p>
              {config.skills.find((s) => s.id === row.id)?.source && (
                <p>
                  固定来源 ·{" "}
                  <code>
                    {config.skills.find((s) => s.id === row.id)?.source}
                  </code>
                </p>
              )}
              <button
                disabled={busy || !library.state}
                onClick={() => toggle(row.id)}
              >
                {enabled(row.id) ? "停用" : "启用"}
                {row.kind === "插件" ? "整套扩展" : ""}
              </button>
              {row.id === "pr-review" && (
                <div className="extension-detail-links">
                  {catalog
                    .filter((r) => r.id === "github" || r.id === "review-pr")
                    .map((r) => (
                      <button
                        key={r.id}
                        onClick={() => {
                          setFilter("全部");
                          setSearch("");
                          select(r.id);
                        }}
                      >
                        {r.name} · {r.kind} →
                      </button>
                    ))}
                </div>
              )}
              {row.id === "github" && (
                <fieldset>
                  <legend>仓库账号</legend>
                  {repo ? (
                    <>
                      <p>{repo}</p>
                      <label>
                        GitHub 登录名
                        <input
                          value={login}
                          placeholder="GitHub 用户名"
                          onChange={(e) => setLogin(e.target.value)}
                        />
                      </label>
                      <label>
                        连接方式
                        <select
                          value={auth}
                          onChange={(e) =>
                            setAuth(e.target.value as Binding["auth"])
                          }
                        >
                          <option value="cli">本机 GitHub CLI</option>
                          <option value="keygrant">Keygrant</option>
                        </select>
                      </label>
                      {auth === "keygrant" && loginPattern.test(login) && (
                        <p>
                          凭据引用 <code>{githubKey(login)}</code>，首次调用时由
                          Keygrant 授权。
                        </p>
                      )}
                      <button
                        disabled={
                          busy || !library.state || !loginPattern.test(login)
                        }
                        onClick={() =>
                          save({
                            ...config,
                            bindings: [
                              ...config.bindings.filter((b) => b.repo !== repo),
                              { repo, login: login.toLowerCase(), auth },
                            ],
                          })
                        }
                      >
                        保存绑定
                      </button>
                      {binding && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            save({
                              ...config,
                              bindings: config.bindings.filter(
                                (b) => b.repo !== repo,
                              ),
                            })
                          }
                        >
                          解除绑定
                        </button>
                      )}
                    </>
                  ) : (
                    <p>在聊天中添加带 GitHub origin 的仓库，即可绑定账号。</p>
                  )}
                  <p>
                    {managed
                      ? "当前 Codex 会话使用自己的 MCP 配置。"
                      : binding?.auth === "cli" &&
                          identity?.toLowerCase() ===
                            binding.login.toLowerCase()
                        ? "本机账号已匹配"
                        : identity
                          ? "本机 GitHub CLI · " + identity
                          : "本机 GitHub CLI 尚未连接"}
                  </p>
                  {binding?.auth === "cli" &&
                    identity?.toLowerCase() !== binding.login.toLowerCase() && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await window.anvil.connectGithub(binding.login);
                            setDeviceCheck((n) => n + 1);
                          })
                        }
                      >
                        连接 GitHub
                      </button>
                    )}
                  <button onClick={() => setDeviceCheck((n) => n + 1)}>
                    重新检测
                  </button>
                </fieldset>
              )}
              {row.id === "playwright" && (
                <p>
                  {managed
                    ? "当前 Codex 会话使用自己的浏览器工具。"
                    : chrome
                      ? "本机 Chrome 可用"
                      : "此设备需要受支持的 Chrome 安装。"}
                </p>
              )}
              {row.kind === "Skill" && (
                <button
                  disabled={
                    !enabled(row.id) ||
                    (row.id === "review-pr" &&
                      !reviewAvailable)
                  }
                  onClick={() => onUse(row.id)}
                >
                  在聊天中使用
                </button>
              )}
              {config.skills.some((s) => s.id === row.id) && (
                <button
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("从账号及其他设备移除这个 Skill？"))
                      save({
                        ...config,
                        skills: config.skills.filter((s) => s.id !== row.id),
                      });
                  }}
                >
                  从账号移除
                </button>
              )}
            </>
          )}
        </article>
      </div>
      {library.error && (
        <p role="alert">
          {library.error}{" "}
          <button onClick={() => void act(() => library.reload())}>
            刷新配置
          </button>
        </p>
      )}
    </section>
  );
}
