import { useRef, useState } from "react";
import { Check, MessageCircleQuestion } from "lucide-react";
import type { AgentQuestionGroup } from "../shared/api";

export function AgentQuestions({
  group,
  disabled,
  onAnswer,
}: {
  group: AgentQuestionGroup;
  disabled: boolean;
  onAnswer(values: string[]): Promise<void>;
}) {
  const [choices, setChoices] = useState<Record<number, number>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const values = group.questions.map((question, index) =>
    choices[index] >= 0
      ? question.options?.[choices[index]] || ""
      : custom[index] || "",
  );
  const locked = disabled || busy || group.readOnly;
  return (
    <section className="agent-questions" aria-label="需要你回答">
      <header>
        <MessageCircleQuestion size={17} />
        <span>
          {group.answer ? "已回答" : group.readOnly ? "来自原聊天" : "请回答"}
        </span>
      </header>
      {group.answer ? (
        <div className="question-answers">
          {group.questions.map((question, index) => (
            <div key={index}>
              <strong>{question.title}</strong>
              <p>
                <Check size={15} />
                {group.answer!.values[index]}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              locked ||
              submitting.current ||
              values.some((value) => !value.trim())
            )
              return;
            submitting.current = true;
            setBusy(true);
            setError("");
            try {
              await onAnswer(values);
            } catch (e) {
              setError(String(e));
            } finally {
              submitting.current = false;
              setBusy(false);
            }
          }}
        >
          {group.questions.map((question, index) => (
            <fieldset key={index} disabled={busy || group.readOnly}>
              <legend>{question.title}</legend>
              {!!question.options?.length && (
                <div className="question-options">
                  {question.options.map((option, optionIndex) => (
                    <label
                      key={optionIndex}
                      className={
                        choices[index] === optionIndex ? "selected" : ""
                      }
                    >
                      <input
                        type="radio"
                        name={`${group.id}-${index}`}
                        checked={choices[index] === optionIndex}
                        onChange={() =>
                          setChoices((current) => ({
                            ...current,
                            [index]: optionIndex,
                          }))
                        }
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              )}
              <textarea
                rows={2}
                maxLength={4000}
                aria-label={`你的回答：${question.title}`}
                placeholder={
                  question.options?.length ? "或输入自己的答案…" : "输入答案…"
                }
                value={custom[index] || ""}
                onChange={(event) => {
                  setCustom((current) => ({
                    ...current,
                    [index]: event.target.value,
                  }));
                  setChoices((current) => ({ ...current, [index]: -1 }));
                }}
              />
            </fieldset>
          ))}
          {!group.readOnly && (
            <footer>
              <span>
                {disabled
                  ? "结束当前任务或恢复此聊天后即可回答。"
                  : "选择一个选项，或输入自己的答案。"}
              </span>
              <button
                type="submit"
                disabled={locked || values.some((value) => !value.trim())}
              >
                {busy ? "正在发送…" : "提交回答"}
              </button>
            </footer>
          )}
          {error && (
            <p className="question-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
