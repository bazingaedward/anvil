import { useEffect, useState } from "react";
import { Copy, Check, Download, GitFork, BookmarkPlus } from "lucide-react";
export function AnswerActions({
  text,
  disabled,
  onFork,
  onMemory,
}: {
  text: string;
  disabled: boolean;
  onFork: () => void;
  onMemory: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setError("");
    } catch {
      setError("复制失败，请重试。");
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "Anvil-回答.md";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="answer-actions" role="group" aria-label="回答操作">
      <button
        title={copied ? "已复制" : "复制回答"}
        aria-label={copied ? "已复制" : "复制回答"}
        onClick={() => void copy()}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
      <button
        title="保存为 Markdown"
        aria-label="保存为 Markdown"
        onClick={download}
      >
        <Download size={15} />
      </button>
      <button
        title="从此回答分叉聊天"
        aria-label="从此回答分叉聊天"
        disabled={disabled}
        onClick={onFork}
      >
        <GitFork size={15} />
      </button>
      <button
        title="存为记忆"
        aria-label="存为记忆"
        disabled={disabled}
        onClick={onMemory}
      >
        <BookmarkPlus size={15} />
      </button>
      <span role="status">{error || (copied ? "已复制" : "")}</span>
    </div>
  );
}
