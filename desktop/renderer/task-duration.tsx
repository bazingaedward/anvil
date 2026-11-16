import { useEffect, useState } from "react";
import type { AgentTask } from "../shared/api";

export function TaskDuration({ task }: { task: AgentTask }) {
  const [now, setNow] = useState(Date.now());
  const running = task.status === "running";
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [task.id, running]);
  const end = running ? now : task.endedAt;
  if (task.startedAt === undefined || end === undefined) return null;
  const seconds = Math.max(0, Math.floor((end - task.startedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const time = [
    ...(hours ? [String(hours)] : []),
    String(minutes).padStart(2, "0"),
    String(seconds % 60).padStart(2, "0"),
  ].join(":");
  return (
    <span
      className="task-duration"
      aria-live="off"
      title="本轮总耗时，包含模型、工具及等待回答的时间"
    >
      · {running ? "已运行" : "耗时"} {time}
    </span>
  );
}
