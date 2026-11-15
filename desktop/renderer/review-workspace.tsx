import { createPortal } from "react-dom";
import { accountScope } from "./account";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  MoreVertical,
  CloudDownload,
  TerminalSquare,
  FolderGit2,
  GitBranch,
  RefreshCw,
  X,
  Plus,
  Search,
} from "lucide-react";
import type {
  RepoState,
  DiffDocument,
  DiffSide,
  ReviewHistory,
} from "../shared/api";
import { CodeDiff } from "./code-editor";
import { ReviewSearchPanel } from "./review-search";
import { graphRows } from "./review-graph";
const name = (root: string) => root.split(/[\\/]/).pop() || root;
const colors = [
  "#70a7eb",
  "#b78ce1",
  "#75c591",
  "#e5ae6d",
  "#e585a9",
  "#6bc5ce",
];
export function ReviewWorkspace({
  children,
  roots,
  open,
  sidebarOpen,
}: {
  children: ReactNode;
  roots: string[];
  open: boolean;
  sidebarOpen: boolean;
}) {
  const [repositories, setRepositories] = useState<string[]>([]);
  const [active, setActive] = useState("");
  const [error, setError] = useState("");
  const hiddenKey = "anvil:review-hidden:" + accountScope;
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(hiddenKey) || "[]");
      return Array.isArray(value)
        ? value.filter((root): root is string => typeof root === "string")
        : [];
    } catch {
      return [];
    }
  });
  const hiddenRef = useRef(hidden);
  const visible = repositories.filter((root) => !hidden.includes(root));
  const [removed, setRemoved] = useState<{
    root: string;
    wasActive: boolean;
  } | null>(null);
  const [menu, setMenu] = useState<{
    root: string;
    left: number;
    top: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  function changeHidden(next: string[]) {
    localStorage.setItem(hiddenKey, JSON.stringify(next));
    hiddenRef.current = next;
    setHidden(next);
  }
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !menuTrigger.current?.contains(event.target as Node)
      )
        setMenu(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenu(null);
        menuTrigger.current?.focus();
      }
      if (event.key === "Tab") setMenu(null);
    };
    const scroll = () => setMenu(null);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", scroll);
    sidebarRef.current?.addEventListener("scroll", scroll);
    const sidebar = sidebarRef.current;
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", scroll);
      sidebar?.removeEventListener("scroll", scroll);
    };
  }, [menu]);
  useEffect(() => {
    if (!open || !sidebarOpen) setMenu(null);
  }, [open, sidebarOpen]);
  function remove(root: string) {
    try {
      changeHidden([
        ...hiddenRef.current.filter((item) => item !== root),
        root,
      ]);
      const index = visible.indexOf(root);
      const next = visible[index + 1] || visible[index - 1] || "";
      const wasActive = active === root;
      if (wasActive) setActive(next);
      setRemoved({ root, wasActive });
      setMenu(null);
      setError("");
      requestAnimationFrame(() =>
        sidebarRef.current
          ?.querySelector<HTMLButtonElement>(
            ".review-repository[aria-pressed=true], [aria-label='Open repository']",
          )
          ?.focus(),
      );
    } catch (e) {
      setError(String(e));
    }
  }
  function undo() {
    if (!removed) return;
    try {
      changeHidden(hiddenRef.current.filter((root) => root !== removed.root));
      if (removed.wasActive || !active) setActive(removed.root);
      setRemoved(null);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      roots.map(async (root) => {
        try {
          return (await window.anvil.reviewStatus(root)).git ? root : null;
        } catch {
          return null;
        }
      }),
    ).then((items) => {
      if (cancelled) return;
      const valid = items.filter((item): item is string => !!item);
      setRepositories((old) => [...new Set([...old, ...valid])]);
      setActive((old) =>
        old && !hiddenRef.current.includes(old)
          ? old
          : valid.find((root) => !hiddenRef.current.includes(root)) || "",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [roots.join("\n")]);
  async function add() {
    try {
      const root = await window.anvil.openReviewRepository();
      if (!root) return;
      changeHidden(hiddenRef.current.filter((item) => item !== root));
      if (removed?.root === root) setRemoved(null);
      setRepositories((old) => [...new Set([...old, root])]);
      setActive(root);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <>
      <div style={{ display: open ? "none" : "contents" }}>{children}</div>
      <div className="review-workspace" hidden={!open}>
        <aside
          ref={sidebarRef}
          id="review-sidebar"
          className="review-sidebar"
          hidden={!sidebarOpen}
        >
          <h2>代码审查</h2>
          <div className="review-sidebar-label">
            <span>仓库</span>
            <button
              aria-label="打开仓库"
              title="打开仓库"
              onClick={() => void add()}
            >
              <Plus size={17} />
            </button>
          </div>
          {visible.map((root) => (
            <div
              key={root}
              className="review-repository-row"
              data-active={active === root}
            >
              <button
                className="review-repository"
                aria-pressed={active === root}
                title={root}
                onClick={() => {
                  setActive(root);
                  setMenu(null);
                }}
              >
                <FolderGit2 size={18} />
                <span>{name(root)}</span>
              </button>
              <button
                className="review-repository-more"
                aria-label={`仓库操作： ${name(root)}`}
                title="仓库操作"
                aria-haspopup="menu"
                aria-expanded={menu?.root === root}
                onClick={(event) => {
                  if (menu?.root === root) {
                    setMenu(null);
                    return;
                  }
                  menuTrigger.current = event.currentTarget;
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu({
                    root,
                    left: Math.max(
                      8,
                      Math.min(rect.right - 180, window.innerWidth - 188),
                    ),
                    top: Math.min(rect.bottom + 4, window.innerHeight - 56),
                  });
                }}
              >
                <MoreVertical size={17} />
              </button>
            </div>
          ))}
          {!visible.length && (
            <button onClick={() => void add()}>打开仓库…</button>
          )}
          {error && <p role="alert">{error}</p>}
        </aside>
        <main className="review-main">
          {!active && (
            <div className="review-empty">
              <FolderGit2 size={28} />
              <h2>审查你的代码</h2>
              <p>打开本地仓库，查看历史和变更。</p>
              <button onClick={() => void add()}>打开仓库…</button>
            </div>
          )}
          {repositories.map((root) => (
            <div
              key={root}
              className="review-repository-view"
              hidden={active !== root}
            >
              <RepositoryReview root={root} active={open && active === root} />
            </div>
          ))}
        </main>
      </div>
      {open && removed && (
        <div className="review-remove-notice" role="status">
          <span>已移除 {name(removed.root)} （仅从列表移除）。</span>
          <button onClick={undo}>撤销</button>
          <button aria-label="关闭移除提示" onClick={() => setRemoved(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      {open &&
        sidebarOpen &&
        menu &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`仓库操作： ${name(menu.root)}`}
            className="review-repository-menu"
            style={{ left: menu.left, top: menu.top }}
          >
            <button role="menuitem" onClick={() => remove(menu.root)}>
              从列表移除
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
function RepositoryReview({ root, active }: { root: string; active: boolean }) {
  const [state, setState] = useState<RepoState>();
  const [history, setHistory] = useState<ReviewHistory>({
    commits: [],
    branches: [],
  });
  const [limit, setLimit] = useState(100);
  const [mode, setMode] = useState("history");
  const [branch, setBranch] = useState("");
  const [remotes, setRemotes] = useState(true);
  const [stash, setStash] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyCommit, setHistoryCommit] = useState("");
  const [terminalBusy, setTerminalBusy] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const graph = useRef<HTMLDivElement>(null);
  function closeSearch() {
    setSearchOpen(false);
    searchButton.current?.focus();
  }
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
      } else if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        closeSearch();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active, searchOpen]);
  async function openTerminal() {
    setTerminalBusy(true);
    try {
      await window.anvil.openRepositoryTerminal(root);
    } catch (e) {
      setFetchNotice({ message: String(e), failed: true });
    } finally {
      setTerminalBusy(false);
    }
  }
  const [diff, setDiff] = useState<DiffDocument>();
  const [patch, setPatch] = useState("");
  const [selected, setSelected] = useState("");
  const [base, setBase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchNotice, setFetchNotice] = useState<{
    message: string;
    failed?: boolean;
  } | null>(null);
  const fetchPending = useRef(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const request = useRef(0),
    refreshRequest = useRef(0);
  async function refresh(throwOnError = false) {
    const id = ++refreshRequest.current;
    setBusy(true);
    try {
      const [s, h] = await Promise.all([
        window.anvil.reviewStatus(root),
        window.anvil.reviewHistory(root, limit, {
          branch,
          remotes,
          stash,
          commit: historyCommit || undefined,
        }),
      ]);
      if (id !== refreshRequest.current) return;
      setState(s);
      setHistory(h);
      setError("");
    } catch (e) {
      if (throwOnError) throw e;
      if (id === refreshRequest.current) setError(String(e));
    } finally {
      if (id === refreshRequest.current) setBusy(false);
    }
  }
  async function fetchRemoteUpdates() {
    if (fetchPending.current) return;
    fetchPending.current = true;
    setFetching(true);
    setFetchNotice({ message: "正在获取远程更新…" });
    setError("");
    try {
      await window.anvil.fetchRemotes(root);
      clear();
      await refresh(true);
      setFetchNotice(null);
    } catch (e) {
      setFetchNotice({ message: String(e), failed: true });
    } finally {
      fetchPending.current = false;
      setFetching(false);
    }
  }
  useEffect(() => {
    if (active) void refresh();
    return () => {
      ++refreshRequest.current;
    };
  }, [active, limit, branch, remotes, stash, historyCommit]);
  useEffect(() => {
    if (historyCommit && graph.current) graph.current.scrollTop = 0;
  }, [history]);
  function clear() {
    ++request.current;
    setSelected("");
    setDiff(undefined);
    setPatch("");
    setDetailBusy(false);
  }
  async function inspect(value: string, side?: DiffSide) {
    const id = ++request.current;
    setSelected(value);
    setDiff(undefined);
    setPatch("");
    setDetailBusy(true);
    setError("");
    try {
      if (side) {
        const result = await window.anvil.reviewDiff(root, value, side);
        if (id === request.current) setDiff(result);
      } else {
        const result = await window.anvil.reviewPatch(
          root,
          value,
          base || undefined,
        );
        if (id === request.current) setPatch(result);
      }
    } catch (e) {
      if (id === request.current) setError(String(e));
    } finally {
      if (id === request.current) setDetailBusy(false);
    }
  }
  const rows = useMemo(() => graphRows(history.commits), [history]);
  const graphWidth = Math.max(84, ...rows.map((row) => row.width * 18 + 24));
  const detail = (
    <div className="review-detail">
      <header>
        <span>
          {selected.length >= 40 && mode === "history"
            ? `${base ? base.slice(0, 8) + " → " : ""}${selected.slice(0, 8)}`
            : selected || "选择文件查看变更"}
        </span>
        {selected && (
          <button aria-label="关闭变更" onClick={clear}>
            <X size={16} />
          </button>
        )}
      </header>
      {detailBusy ? (
        <p className="review-muted" role="status">
          正在加载变更…
        </p>
      ) : diff ? (
        <>
          {diff.note && <p>{diff.note}</p>}
          <CodeDiff
            original={diff.original}
            modified={diff.modified}
            language="plaintext"
          />
        </>
      ) : (
        selected && <CommitPatch key={selected + base} patch={patch} />
      )}
    </div>
  );
  return (
    <section className="repository-review">
      <header className="review-heading">
        <div>
          <h2 title={root}>{name(root)}</h2>
          <span>
            <GitBranch size={14} /> {state?.branch}
          </span>
        </div>
        <div className="review-actions">
          <button
            ref={searchButton}
            title="搜索提交（⌘F / Ctrl+F）"
            aria-label="搜索仓库历史"
            aria-expanded={searchOpen}
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          >
            <Search size={18} />
          </button>
          <button
            title="在终端中打开仓库"
            aria-label="在终端中打开仓库"
            disabled={terminalBusy}
            onClick={() => void openTerminal()}
          >
            <TerminalSquare size={19} />
          </button>
          <button
            title="获取远程更新"
            aria-label="获取远程更新"
            aria-busy={fetching}
            disabled={busy || fetching}
            onClick={() => void fetchRemoteUpdates()}
          >
            <CloudDownload size={19} />
          </button>
          <button
            title="刷新仓库"
            aria-label="刷新仓库"
            disabled={busy || fetching}
            onClick={() => {
              clear();
              void refresh();
            }}
          >
            <RefreshCw size={17} className={busy ? "review-spinning" : ""} />
          </button>
        </div>
      </header>
      {active && searchOpen && (
        <ReviewSearchPanel
          root={root}
          options={{ branch, remotes, stash }}
          onClose={closeSearch}
          onSelect={(commit) => {
            setHistoryCommit(commit.hash);
            setMode("history");
            setLimit(100);
            closeSearch();
            void inspect(commit.hash);
          }}
        />
      )}
      {active && fetchNotice && (
        <div className="review-fetch-notice">
          <div role={fetchNotice.failed ? "alert" : "status"}>
            {fetching && (
              <span className="review-fetch-spinner" aria-hidden="true">
                <RefreshCw size={20} className="review-spinning" />
              </span>
            )}
            <span>{fetchNotice.message}</span>
          </div>
          <button onClick={() => setFetchNotice(null)}>关闭</button>
        </div>
      )}
      <nav className="review-views">
        {[
          ["history", "提交图"],
          ["changes", `工作区变更${state ? ` (${state.changes.length})` : ""}`],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={mode === value}
            onClick={() => {
              clear();
              setMode(value);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="review-error">
          {error}
        </p>
      )}
      {mode === "history" ? (
        <>
          <div className="graph-controls">
            <select
              aria-label="分支"
              value={branch}
              onChange={(e) => {
                clear();
                setHistoryCommit("");
                setBranch(e.target.value);
              }}
            >
              <option value="">所有分支</option>
              {history.branches
                .filter((ref) => remotes || !ref.startsWith("refs/remotes/"))
                .map((ref) => (
                  <option key={ref} value={ref}>
                    {ref.replace(/^refs\/(heads|remotes)\//, "")}
                  </option>
                ))}
            </select>
            <label>
              <input
                type="checkbox"
                checked={remotes}
                onChange={(e) => {
                  setHistoryCommit("");
                  setRemotes(e.target.checked);
                  setBranch("");
                  clear();
                }}
              />{" "}
              远程分支
            </label>
            <label>
              <input
                type="checkbox"
                checked={stash}
                onChange={(e) => {
                  setHistoryCommit("");
                  setStash(e.target.checked);
                  clear();
                }}
              />{" "}
              暂存记录
            </label>
          </div>
          {base && (
            <div className="review-comparison">
              比较起点 {base.slice(0, 8)} · 选择另一个提交
              <button
                onClick={() => {
                  setBase("");
                  clear();
                }}
              >
                取消
              </button>
            </div>
          )}
          {historyCommit && (
            <div className="review-comparison">
              历史起点 {historyCommit.slice(0, 8)}
              <button
                onClick={() => {
                  setHistoryCommit("");
                  clear();
                }}
              >
                返回最新历史
              </button>
            </div>
          )}
          <div
            ref={graph}
            className={`graph-scroll ${selected ? "has-detail" : ""}`}
          >
            <table className="commit-table">
              <thead>
                <tr>
                  <th style={{ width: graphWidth }}>图谱</th>
                  <th>说明</th>
                  <th>日期</th>
                  <th>作者</th>
                  <th>提交</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ commit, column, color, edges, incoming }) => (
                  <tr
                    key={commit.hash}
                    className={selected === commit.hash ? "selected" : ""}
                  >
                    <td className="graph-cell">
                      <svg width={graphWidth} height={36} aria-hidden="true">
                        {edges.map((edge, i) => (
                          <path
                            key={i}
                            d={`M ${16 + edge.from * 18} ${edge.start ? 18 : 0} C ${16 + edge.from * 18} 27, ${16 + edge.to * 18} 27, ${16 + edge.to * 18} 36`}
                            stroke={colors[edge.color % colors.length]}
                            strokeWidth="2"
                            fill="none"
                          />
                        ))}
                        {incoming && (
                          <path
                            d={`M ${16 + column * 18} 0 V 18`}
                            stroke={colors[color % colors.length]}
                            strokeWidth="2"
                          />
                        )}
                        <circle
                          cx={16 + column * 18}
                          cy={18}
                          r={4.5}
                          fill={colors[color % colors.length]}
                        />
                      </svg>
                    </td>
                    <td className="commit-description">
                      <button
                        onClick={() => void inspect(commit.hash)}
                        title={commit.title}
                      >
                        {commit.refs.map((ref) => (
                          <span className="commit-ref" key={ref}>
                            {ref}
                          </span>
                        ))}
                        <span>{commit.title}</span>
                      </button>
                    </td>
                    <td>{new Date(commit.date).toLocaleDateString()}</td>
                    <td title={commit.author}>{commit.author}</td>
                    <td>
                      <button
                        className="commit-hash"
                        title="查看提交变更"
                        onClick={() => void inspect(commit.hash)}
                      >
                        {commit.hash.slice(0, 8)}
                      </button>
                      <button
                        className="compare-commit"
                        title="以此提交为比较起点"
                        aria-label={`从此提交比较 ${commit.hash.slice(0, 8)}`}
                        onClick={() => {
                          clear();
                          setBase(commit.hash);
                        }}
                      >
                        ↔
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <p className="review-muted">
                {busy ? "正在加载历史…" : "暂无提交。"}
              </p>
            )}
            {history.commits.length >= limit && limit < 1000 && (
              <button
                className="graph-more"
                disabled={busy}
                onClick={() => setLimit((n) => n + 100)}
              >
                加载更多提交
              </button>
            )}
            {limit === 1000 && history.commits.length >= limit && (
              <p className="review-muted">
                显示前 1,000 个提交，可选择分支缩小范围。
              </p>
            )}
          </div>
          {selected && detail}
        </>
      ) : (
        <div className="review-changes">
          <aside>
            {(["worktree", "index"] as const).map((side) => (
              <section key={side}>
                <h4>{side === "index" ? "已暂存" : "未暂存"}</h4>
                {state?.changes
                  .filter((c) =>
                    side === "index"
                      ? c.index !== " " && c.index !== "?"
                      : c.worktree !== " ",
                  )
                  .map((c) => (
                    <button
                      key={c.path}
                      title={
                        c.originalPath
                          ? `${c.originalPath} → ${c.path}`
                          : c.path
                      }
                      onClick={() => void inspect(c.path, side)}
                    >
                      <span>{side === "index" ? c.index : c.worktree}</span>
                      {c.path}
                    </button>
                  ))}
              </section>
            ))}
            {state && !state.changes.length && (
              <p className="review-muted">没有工作区变更。</p>
            )}
          </aside>
          {detail}
        </div>
      )}
    </section>
  );
}

function CommitPatch({ patch }: { patch: string }) {
  const [file, setFile] = useState(-1);
  const parts = useMemo(() => patch.split(/(?=^diff --git )/m), [patch]);
  const files = parts.filter((part) => part.startsWith("diff --git "));
  const shown = file >= 0 ? files[file] || patch : patch;
  return (
    <div className="commit-patch-layout">
      {files.length > 0 && (
        <aside>
          <button aria-pressed={file === -1} onClick={() => setFile(-1)}>
            所有变更（{files.length})
          </button>
          {files.map((part, index) => {
            const header = part.split("\n")[0].replace(/^diff --git /, "");
            const label =
              part.match(/^\+\+\+ b\/(.*)$/m)?.[1] ||
              part.match(/^--- a\/(.*)$/m)?.[1] ||
              header;
            return (
              <button
                key={index}
                title={header}
                aria-pressed={file === index}
                onClick={() => setFile(index)}
              >
                {label}
              </button>
            );
          })}
        </aside>
      )}
      <pre className="review-patch">
        {shown
          ? shown.split("\n").map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith("+")
                    ? "added"
                    : line.startsWith("-")
                      ? "removed"
                      : ""
                }
              >
                {line || " "}
              </div>
            ))
          : "暂无变更。"}
      </pre>
    </div>
  );
}
