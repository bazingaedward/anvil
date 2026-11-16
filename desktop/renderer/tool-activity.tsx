import { useEffect, useState } from "react";
import { Check, ChevronRight, LoaderCircle, X } from "lucide-react";
import type { AgentTask, AgentTool } from "../shared/api";
export function ToolActivity({ task }: { task: AgentTask }) {
  const [now, setNow] = useState(Date.now());
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (task.status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [task.status]);
  const tools = task.tools || [];
  const running = tools.filter(
    (tool) => tool.status === "running" && task.status === "running",
  );
  const completed = tools.filter((tool) => !running.includes(tool));
  function row(tool: AgentTool) {
    const active = running.includes(tool);
    const status = active
      ? "执行中"
      : tool.status === "completed"
        ? "已完成"
        : tool.status === "failed"
          ? "失败"
          : "已停止";
    const seconds = Math.max(
      0,
      Math.floor(
        ((tool.endedAt || (active ? now : task.updated)) - tool.startedAt) /
          1000,
      ),
    );
    const Icon = active
      ? LoaderCircle
      : tool.status === "completed"
        ? Check
        : X;
    return (
      <li key={tool.id}>
        <Icon size={14} className={active ? "tool-spinner" : undefined} />
        <div>
          <strong>{tool.name}</strong>
          {tool.summary && <code>{tool.summary}</code>}
        </div>
        <small>
          {status} · {seconds}s
        </small>
      </li>
    );
  }
  if (!tools.length) return null;
  return (
    <section className="tool-activity" aria-label="工具执行记录">
      {!!running.length && <ul>{running.map(row)}</ul>}
      {!!completed.length && (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            <ChevronRight
              size={14}
              style={{ transform: expanded ? "rotate(90deg)" : undefined }}
            />
            工具记录 · {task.toolCount || tools.length} 次
          </button>
          <ul>{(expanded ? completed : completed.slice(-3)).map(row)}</ul>
        </>
      )}
    </section>
  );
}
