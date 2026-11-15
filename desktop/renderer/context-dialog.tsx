import { useEffect, useRef, useState } from "react";
import type { ContextState, MemoryInput } from "../shared/memory";
import { MarkdownResponse } from "./markdown-response";
export function ContextDialog({
  conversationID,
  disabled,
  initialMemory,
  onClose,
}: {
  conversationID: string;
  disabled: boolean;
  initialMemory?: MemoryInput;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<ContextState>();
  const [edit, setEdit] = useState<MemoryInput | undefined>(initialMemory);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function action(work: () => Promise<ContextState>) {
    setBusy(true);
    setError("");
    try {
      setData(await work());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    dialog.current?.showModal();
    void action(() => window.anvil.contextState(conversationID));
  }, [conversationID]);
  return (
    <dialog ref={dialog} className="context-dialog" onCancel={onClose}>
      <header>
        <h2>记忆</h2>
        <button onClick={onClose} aria-label="关闭记忆窗口">
          ×
        </button>
      </header>
      <p className="context-help">
        记忆以 Markdown 文件保存在本机。直接告诉
        Anvil“记住……”或“忘掉……”，它会维护记忆，新聊天自动读取。删除记忆不会清除已有聊天历史。
      </p>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p>正在加载…</p>
      ) : (
        <>
          <label className="context-check">
            <input
              type="checkbox"
              checked={data.enabled}
              disabled={disabled || busy}
              onChange={(e) =>
                void action(() =>
                  window.anvil.setAutoMemory(conversationID, e.target.checked),
                )
              }
            />
            自动记忆
          </label>
          <div className="answer-actions">
            <button
              onClick={() =>
                void window.anvil
                  .openMemoryFolder(conversationID)
                  .catch((e) => setError(String(e)))
              }
            >
              打开记忆文件夹
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void action(() => window.anvil.contextState(conversationID))
              }
            >
              刷新
            </button>
          </div>
          <p className="context-help">
            {data.enabled
              ? "已开启：自动加载索引并允许 Agent 维护记忆。"
              : "已关闭：不再注入记忆或启用自动维护，已有文件保留。"}
          </p>
          {!data.notes.length && (
            <p>暂无记忆。你可以在聊天里说：“记住，我希望你用中文回复。”</p>
          )}
          {data.notes.map((note) => (
            <details key={note.id} className="context-evidence">
              <summary>{note.title}</summary>
              <small>{note.scope || "全局偏好"}</small>
              <MarkdownResponse text={note.body} />
              <div className="answer-actions">
                <button
                  disabled={disabled || busy}
                  onClick={() => setEdit(note)}
                >
                  编辑
                </button>
                <button
                  disabled={disabled || busy}
                  onClick={() => {
                    if (window.confirm(`删除“${note.title}”？`))
                      void action(() =>
                        window.anvil.deleteMemory(
                          conversationID,
                          note.id,
                          note.revision,
                        ),
                      );
                  }}
                >
                  删除
                </button>
              </div>
            </details>
          ))}
          {edit && (
            <fieldset disabled={disabled || busy}>
              <legend>{edit.id ? "编辑记忆" : "从回答保存记忆"}</legend>
              {!edit.id && (
                <p className="context-help">
                  已带入回答的前 1200
                  字，请精简为值得长期保留的信息。保存后会自动进入记忆索引。
                </p>
              )}
              <label>
                标题
                <input
                  maxLength={120}
                  value={edit.title}
                  onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                />
              </label>
              <label>
                内容
                <textarea
                  rows={8}
                  maxLength={64000}
                  value={edit.body}
                  onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                />
              </label>
              <button
                disabled={!edit.title.trim() || !edit.body.trim()}
                onClick={() =>
                  void action(async () => {
                    const result = await window.anvil.saveMemory(
                      conversationID,
                      edit,
                    );
                    setEdit(undefined);
                    return result;
                  })
                }
              >
                保存
              </button>
              <button onClick={() => setEdit(undefined)}>取消</button>
            </fieldset>
          )}
        </>
      )}
    </dialog>
  );
}
