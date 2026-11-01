import type { AgentTask, Conversation, LegacyDraft } from "../shared/api";

export function readLegacyDrafts(storage: Storage): LegacyDraft[] {
  const saved = storage.getItem("anvil:conversations:v2");
  const sources =
    saved !== null
      ? [saved]
      : Object.keys(storage)
          .filter((key) => key.startsWith("anvil:drafts:"))
          .map((key) => storage.getItem(key)!);
  const result: LegacyDraft[] = [];
  for (const source of sources) {
    const values: unknown = JSON.parse(source);
    if (
      !Array.isArray(values) ||
      values.some(
        (value) =>
          typeof value?.id !== "string" || typeof value?.text !== "string",
      )
    )
      throw new Error(
        "Could not import older drafts. Their original local data has been preserved.",
      );
    for (const value of values)
      if (!result.some((item) => item.id === value.id)) result.push(value);
  }
  return result;
}
export function conversationTitle(item: Conversation, tasks: AgentTask[]) {
  return (
    item.title ||
    tasks
      .find((task) => task.conversationID === item.id)
      ?.prompt.trim()
      .split("\n")[0]
      .slice(0, 48) ||
    item.text.trim().split("\n")[0].slice(0, 48) ||
    "New conversation"
  );
}
export function filterConversations(
  items: Conversation[],
  tasks: AgentTask[],
  search: string,
  archived: boolean,
) {
  const query = search.trim().toLocaleLowerCase();
  return items
    .filter(
      (item) =>
        item.archived === archived &&
        (!query ||
          [
            conversationTitle(item, tasks),
            item.text,
            ...tasks
              .filter((task) => task.conversationID === item.id)
              .flatMap((task) => [task.prompt, task.text]),
          ].some((text) => text.toLocaleLowerCase().includes(query))),
    )
    .sort(
      (a, b) =>
        Math.max(
          b.updated,
          ...tasks
            .filter((t) => t.conversationID === b.id)
            .map((t) => t.updated),
        ) -
        Math.max(
          a.updated,
          ...tasks
            .filter((t) => t.conversationID === a.id)
            .map((t) => t.updated),
        ),
    );
}
