import { accountScope, defaultModelID } from "./account";
import { useEffect, useState } from "react";
import type { Attachment } from "../shared/api";
type Draft = { modelID: string; attachments: Attachment[] };

export function useComposerDraft(id: string) {
  const empty: Draft = { modelID: defaultModelID, attachments: [] };
  const storageKey = "anvil:composer-drafts:" + accountScope;
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    try {
      const values = JSON.parse(localStorage.getItem(storageKey) || "{}");
      if (!values || typeof values !== "object" || Array.isArray(values))
        return {};
      return Object.fromEntries(
        Object.entries(values).filter((entry): entry is [string, Draft] => {
          const draft = entry[1] as Draft;
          return (
            !!draft &&
            typeof draft.modelID === "string" &&
            Array.isArray(draft.attachments) &&
            draft.attachments.length <= 8 &&
            draft.attachments.every(
              (file) =>
                file &&
                typeof file.id === "string" &&
                typeof file.name === "string" &&
                typeof file.mime === "string" &&
                typeof file.size === "number",
            )
          );
        }),
      );
    } catch {
      return {};
    }
  });
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(drafts));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [drafts]);
  const value = drafts[id] || empty;
  const update = (patch: Partial<Draft>, target = id) =>
    setDrafts((old) => ({
      ...old,
      [target]: { ...(old[target] || empty), ...patch },
    }));
  const add = (items: Attachment[], target = id) =>
    setDrafts((old) => {
      const draft = old[target] || empty;
      return {
        ...old,
        [target]: { ...draft, attachments: [...draft.attachments, ...items] },
      };
    });
  return { ...value, update, add, storageError };
}
