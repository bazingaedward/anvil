import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ErrorToast } from "./error-toast";

function CodeBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const code = React.Children.toArray(children).find((child) =>
    React.isValidElement<{ className?: string }>(child),
  );
  const language = React.isValidElement<{ className?: string }>(code)
    ? /language-(\S+)/.exec(code.props.className || "")?.[1]
    : undefined;
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy() {
    try {
      await window.anvil.copyText(preRef.current?.textContent || "");
      setCopied(true);
      setError("");
    } catch {
      setError("复制失败，请重试。");
    }
  }
  return (
    <div className="markdown-code-block">
      <div className="markdown-code-toolbar">
        <span>{language || "文本"}</span>
        <button
          type="button"
          aria-label={copied ? "已复制" : "复制代码块"}
          onClick={() => void copy()}
        >
          {copied ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <Copy size={15} aria-hidden="true" />
          )}
          <span role="status">{copied ? "已复制" : "复制"}</span>
        </button>
      </div>
      <pre ref={preRef}>{children}</pre>
      <ErrorToast message={error} onDismiss={() => setError("")} />
    </div>
  );
}

export function MarkdownResponse({ text }: { text: string }) {
  return (
    <div className="agent-response markdown-response">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          pre: CodeBlock,
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault();
                if (href && /^https?:\/\//i.test(href))
                  void window.anvil.openExternalLink(href).catch(() => {});
              }}
            >
              {children}
            </a>
          ),
          img: ({ alt }) => <span>{alt || "图片"}</span>,
          table: ({ children }) => (
            <div className="markdown-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
