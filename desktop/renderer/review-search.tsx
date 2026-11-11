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
      aria-label="Search repository history"
    >
      <header>
        <strong>Search commits</strong>
        <button aria-label="Close history search" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <input
        autoFocus
        aria-label="Search commits"
        maxLength={200}
        placeholder="Message, author, SHA, branch or tag…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="review-search-scope">
        {options.branch?.replace(/^refs\/(heads|remotes)\//, "") ||
          "All branches"}{" "}
        · {options.remotes ? "including remotes" : "local refs"}
        {options.stash ? " · stashes" : ""} · full local history
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
        {busy && <p role="status">Searching…</p>}
        {!busy && !error && query.trim() && !result.commits.length && (
          <p>No matching commits.</p>
        )}
        {!query.trim() && (
          <p>Search fetched history without changing your files.</p>
        )}
        {result.next !== null && (
          <button
            disabled={busy}
            onClick={() => void load(result.next!, ++request.current)}
          >
            Load more results
          </button>
        )}
      </div>
    </section>
  );
}
