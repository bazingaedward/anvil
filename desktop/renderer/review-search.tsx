import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ReviewCommit, ReviewOptions, ReviewSearch } from "../shared/api";
export function ReviewSearchPanel({
  root,
  options,
  onSelect,
  onClose,
}: {
  root: string;
  options: ReviewOptions;
  onSelect: (commit: ReviewCommit) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ReviewSearch>({
    commits: [],
    next: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  async function load(cursor: number, id: number) {
    setBusy(true);
    setError("");
    try {
      const page = await window.anvil.searchHistory(
        root,
        query,
        cursor,
        options,
      );
      if (id === request.current)
        setResult((old) => ({
          commits: cursor ? [...old.commits, ...page.commits] : page.commits,
          next: page.next,
        }));
    } catch (e) {
      if (id === request.current) setError(String(e));
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  useEffect(() => {
    const id = ++request.current;
    setResult({ commits: [], next: null });
    setError("");
    setBusy(!!query.trim());
    const timer = setTimeout(() => {
      if (query.trim()) void load(0, id);
    }, 250);
    return () => {
      clearTimeout(timer);
      ++request.current;
    };
  }, [query, root, options.branch, options.remotes, options.stash]);
  return (
    <section
      className="review-search-panel"
      role="dialog"
      aria-label="搜索仓库历史"
    >
      <header>
        <strong>搜索提交</strong>
        <button aria-label="关闭历史搜索" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <input
        autoFocus
        aria-label="搜索提交"
        maxLength={200}
        placeholder="提交说明、作者、SHA、分支或标签…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="review-search-scope">
        {options.branch?.replace(/^refs\/(heads|remotes)\//, "") || "所有分支"}{" "}
        · {options.remotes ? "包含远程分支" : "本地引用"}
        {options.stash ? " · 包含暂存记录" : ""} · 完整本地历史
      </p>
      <div className="review-search-results">
        {result.commits.map((commit) => (
          <button key={commit.hash} onClick={() => onSelect(commit)}>
            <strong>{commit.title}</strong>
            <span>
              {commit.author} · {new Date(commit.date).toLocaleDateString()} ·{" "}
              {commit.hash.slice(0, 8)}
            </span>
            {!!commit.refs.length && <span>{commit.refs.join(" · ")}</span>}
          </button>
        ))}
        {error && <p role="alert">{error}</p>}
        {busy && <p role="status">正在搜索…</p>}
        {!busy && !error && query.trim() && !result.commits.length && (
          <p>没有匹配的提交。</p>
        )}
        {!query.trim() && <p>搜索已获取的历史，不会修改文件。</p>}
        {result.next !== null && (
          <button
            disabled={busy}
            onClick={() => void load(result.next!, ++request.current)}
          >
            加载更多结果
          </button>
        )}
      </div>
    </section>
  );
}
