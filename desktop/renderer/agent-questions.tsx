import { useRef, useState } from "react";
import { Check, MessageCircleQuestion } from "lucide-react";
import type { AgentQuestionGroup, QuestionAnswer } from "../shared/api";

export function AgentQuestions({
  group,
  disabled,
  onAnswer,
}: {
  group: AgentQuestionGroup;
  disabled: boolean;
  onAnswer(values: QuestionAnswer[]): Promise<void>;
}) {
  const [choices, setChoices] = useState<Record<number, number[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const values = group.questions.map((question, index) => {
    const selected = (choices[index] || []).map(
      (choice) => question.options?.[choice] || "",
    );
    return question.multiple
      ? [...selected, ...(custom[index]?.trim() ? [custom[index]] : [])]
      : selected[0] || custom[index] || "";
  });
  const incomplete = values.some((value) =>
    Array.isArray(value) ? !value.length : !value.trim(),
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
                {Array.isArray(group.answer!.values[index])
                  ? (group.answer!.values[index] as string[]).join("、")
                  : group.answer!.values[index]}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (locked || submitting.current || incomplete) return;
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
                        choices[index]?.includes(optionIndex) ? "selected" : ""
                      }
                    >
                      <input
                        type={question.multiple ? "checkbox" : "radio"}
                        name={`${group.id}-${index}`}
                        checked={!!choices[index]?.includes(optionIndex)}
                        onChange={() =>
                          setChoices((current) => ({
                            ...current,
                            [index]: question.multiple
                              ? current[index]?.includes(optionIndex)
                                ? current[index].filter(
                                    (v) => v !== optionIndex,
                                  )
                                : [...(current[index] || []), optionIndex]
                              : [optionIndex],
                          }))
                        }
                      />
                      <span>
                        {option}
                        {question.descriptions?.[optionIndex] && (
                          <small className="question-option-description">
                            {question.descriptions[optionIndex]}
                          </small>
                        )}
                      </span>
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
                  if (!question.multiple)
                    setChoices((current) => ({ ...current, [index]: [] }));
                }}
              />
            </fieldset>
          ))}
          {!group.readOnly && (
            <footer>
              <span>
                {disabled
                  ? "结束当前任务或恢复此聊天后即可回答。"
                  : "选择选项或输入答案；多选题可以同时选择多项。"}
              </span>
              <button type="submit" disabled={locked || incomplete}>
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
