import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
export function MarkdownResponse({ text }: { text: string }) {
  return (
    <div className="agent-response markdown-response">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
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
