import { useEffect, useState } from "react";
import { Asterisk } from "lucide-react";
import type { AgentTask } from "../shared/api";

export function taskProgressLabel(task: AgentTask): string {
  if (task.phase === "stopping") return "正在停止…";
  if (task.permissions.length) return "等待授权";
  if (
    task.questions?.some(
      (group) => group.blocking && !group.answer && !group.readOnly,
    )
  )
    return "等待你的回答";
  if (task.phase === "checking") return "验证中…";
  if (task.phase === "repairing") return "修复中…";
  if (task.tools?.some((tool) => tool.status === "running")) return "执行中…";
  return "思考中…";
}

export function taskDuration(task: AgentTask, now: number): string | null {
  if (task.startedAt === undefined || task.status === "queued") return null;
  const end = task.status === "running" ? now : task.endedAt;
  if (end === undefined) return null;
  const seconds = Math.max(0, Math.floor((end - task.startedAt) / 1000));
  const pad = (value: number) => String(value).padStart(2, "0");
  return seconds >= 3600
    ? `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
    : `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

export function TaskDuration({ task }: { task: AgentTask }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (task.status !== "running" || task.startedAt === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [task.id, task.status, task.startedAt]);
  const duration = taskDuration(task, now);
  return duration ? (
    <span className="task-duration" aria-live="off">
      · {task.status === "running" ? "已运行" : "耗时"} {duration}
    </span>
  ) : null;
}

export function TaskProgress({ task }: { task: AgentTask }) {
  const paused =
    task.permissions.length ||
    task.phase === "stopping" ||
    task.questions?.some(
      (group) => group.blocking && !group.answer && !group.readOnly,
    );
  return (
    <div className="agent-progress">
      <Asterisk
        size={24}
        className={`agent-progress-mark ${paused ? "paused" : ""}`}
        aria-hidden="true"
      />
      <span className="agent-progress-label" role="status">
        {taskProgressLabel(task)}
      </span>
      <TaskDuration task={task} />
    </div>
  );
}
