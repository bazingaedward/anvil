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
    <section className="agent-questions" aria-label="Agent questions">
      <header>
        <MessageCircleQuestion size={17} />
        <span>
          {group.answer
            ? "Answered"
            : group.readOnly
              ? "From original chat"
              : "Your input"}
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
                aria-label={`Your answer: ${question.title}`}
                placeholder={
                  question.options?.length
                    ? "Or write your own answer…"
                    : "Write your answer…"
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
                  ? "Finish the running task or restore this chat to reply."
                  : "Choose an option or write your own answer."}
              </span>
              <button
                type="submit"
                disabled={locked || values.some((value) => !value.trim())}
              >
                {busy ? "Sending…" : "Send answers"}
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
