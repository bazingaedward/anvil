import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
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
      setActive((old) => old || valid[0] || "");
    });
    return () => {
      cancelled = true;
    };
  }, [roots.join("\n")]);
  async function add() {
    try {
      const root = await window.anvil.openReviewRepository();
      if (!root) return;
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
          id="review-sidebar"
          className="review-sidebar"
          hidden={!sidebarOpen}
        >
          <h2>Code review</h2>
          <div className="review-sidebar-label">
            <span>Repositories</span>
            <button
              aria-label="Open repository"
              title="Open repository"
              onClick={() => void add()}
            >
              <Plus size={17} />
            </button>
          </div>
          {repositories.map((root) => (
            <button
              key={root}
              className="review-repository"
              aria-pressed={active === root}
              title={root}
              onClick={() => setActive(root)}
            >
              <FolderGit2 size={18} />
              <span>{name(root)}</span>
            </button>
          ))}
          {!repositories.length && (
            <button onClick={() => void add()}>Open repository…</button>
          )}
          {error && <p role="alert">{error}</p>}
        </aside>
        <main className="review-main">
          {!active && (
            <div className="review-empty">
              <FolderGit2 size={28} />
              <h2>Review your code</h2>
              <p>Open a local repository to explore its history and changes.</p>
              <button onClick={() => void add()}>Open repository…</button>
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
  const [search, setSearch] = useState("");
  const [diff, setDiff] = useState<DiffDocument>();
  const [patch, setPatch] = useState("");
  const [selected, setSelected] = useState("");
  const [base, setBase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const request = useRef(0),
    refreshRequest = useRef(0);
  async function refresh() {
    const id = ++refreshRequest.current;
    setBusy(true);
    try {
      const [s, h] = await Promise.all([
        window.anvil.reviewStatus(root),
        window.anvil.reviewHistory(root, limit, { branch, remotes, stash }),
      ]);
      if (id !== refreshRequest.current) return;
      setState(s);
      setHistory(h);
      setError("");
    } catch (e) {
      if (id === refreshRequest.current) setError(String(e));
    } finally {
      if (id === refreshRequest.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (active) void refresh();
    return () => {
      ++refreshRequest.current;
    };
  }, [active, limit, branch, remotes, stash]);
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
  const query = search.trim().toLowerCase();
  const matches = (commit: ReviewHistory["commits"][number]) =>
    !query ||
    [commit.title, commit.author, commit.hash, ...commit.refs]
      .join(" ")
      .toLowerCase()
      .includes(query);
  const detail = (
    <div className="review-detail">
      <header>
        <span>
          {selected.length >= 40 && mode === "history"
            ? `${base ? base.slice(0, 8) + " → " : ""}${selected.slice(0, 8)}`
            : selected || "Select a file to view its changes"}
        </span>
        {selected && (
          <button aria-label="Close changes" onClick={clear}>
            <X size={16} />
          </button>
        )}
      </header>
      {detailBusy ? (
        <p className="review-muted" role="status">
          Loading changes…
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
        <button
          title="Refresh repository"
          aria-label="Refresh repository"
          disabled={busy}
          onClick={() => {
            clear();
            void refresh();
          }}
        >
          <RefreshCw size={17} className={busy ? "review-spinning" : ""} />
        </button>
      </header>
      <nav className="review-views">
        {[
          ["history", "Commit graph"],
          [
            "changes",
            `Working changes${state ? ` (${state.changes.length})` : ""}`,
          ],
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
              aria-label="Branch"
              value={branch}
              onChange={(e) => {
                clear();
                setBranch(e.target.value);
              }}
            >
              <option value="">All branches</option>
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
                  setRemotes(e.target.checked);
                  setBranch("");
                  clear();
                }}
              />{" "}
              Remotes
            </label>
            <label>
              <input
                type="checkbox"
                checked={stash}
                onChange={(e) => {
                  setStash(e.target.checked);
                  clear();
                }}
              />{" "}
              Stashes
            </label>
            <label className="graph-search">
              <Search size={15} />
              <input
                aria-label="Find commit"
                placeholder="Find commit, author or hash…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>
          {base && (
            <div className="review-comparison">
              Comparing from {base.slice(0, 8)} · select another commit
              <button
                onClick={() => {
                  setBase("");
                  clear();
                }}
              >
                Cancel
              </button>
            </div>
          )}
          {query && (
            <p className="review-search-note">
              {history.commits.filter(matches).length} matching commits · other
              rows stay visible to preserve branch connections
            </p>
          )}
          <div className={`graph-scroll ${selected ? "has-detail" : ""}`}>
            <table className="commit-table">
              <thead>
                <tr>
                  <th style={{ width: graphWidth }}>Graph</th>
                  <th>Description</th>
                  <th>Date</th>
                  <th>Author</th>
                  <th>Commit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ commit, column, color, edges, incoming }) => (
                  <tr
                    key={commit.hash}
                    className={`${selected === commit.hash ? "selected" : ""} ${matches(commit) ? "" : "muted-match"}`}
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
                        title="View commit changes"
                        onClick={() => void inspect(commit.hash)}
                      >
                        {commit.hash.slice(0, 8)}
                      </button>
                      <button
                        className="compare-commit"
                        title="Compare from this commit"
                        aria-label={`Compare from ${commit.hash.slice(0, 8)}`}
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
                {busy ? "Loading history…" : "No commits yet."}
              </p>
            )}
            {history.commits.length >= limit && limit < 1000 && (
              <button
                className="graph-more"
                disabled={busy}
                onClick={() => setLimit((n) => n + 100)}
              >
                Load more commits
              </button>
            )}
            {limit === 1000 && history.commits.length >= limit && (
              <p className="review-muted">
                Showing the first 1,000 commits. Select a branch to narrow the
                history.
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
                <h4>{side === "index" ? "Staged" : "Unstaged"}</h4>
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
              <p className="review-muted">No working changes.</p>
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
            All changes ({files.length})
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
          : "No changes to display."}
      </pre>
    </div>
  );
}
