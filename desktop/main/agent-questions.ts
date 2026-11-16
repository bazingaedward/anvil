import type { AgentQuestionGroup, QuestionAnswer } from "../shared/api";

// Both the native event stream and the Anvil worker stream are untrusted input.
export function parseQuestionGroup(
  id: unknown,
  questions: unknown,
): AgentQuestionGroup {
  if (
    typeof id !== "string" ||
    !id ||
    id.length > 200 ||
    !Array.isArray(questions) ||
    !questions.length ||
    questions.length > 10
  )
    throw new Error("Invalid agent questions.");
  return {
    id,
    questions: questions.map((q) => {
      if (
        !q ||
        typeof q.title !== "string" ||
        !q.title.trim() ||
        q.title.length > 4000
      )
        throw new Error("Invalid agent question title.");
      if (
        q.options != null &&
        (!Array.isArray(q.options) ||
          q.options.length > 20 ||
          q.options.some(
            (option: unknown) =>
              typeof option !== "string" ||
              !option.trim() ||
              option.length > 500,
          ))
      )
        throw new Error("Invalid agent question options.");
      return {
        title: q.title,
        ...(q.multiple === true ? { multiple: true } : {}),
        ...(Array.isArray(q.descriptions) &&
        q.descriptions.length === q.options?.length &&
        q.descriptions.every(
          (d: unknown) => typeof d === "string" && d.length <= 2000,
        )
          ? { descriptions: [...q.descriptions] }
          : {}),
        ...(q.options?.length ? { options: [...q.options] } : {}),
      };
    }),
  };
}
export function validateQuestionAnswers(
  group: AgentQuestionGroup,
  answers: unknown,
): QuestionAnswer[] {
  if (
    !Array.isArray(answers) ||
    answers.length !== group.questions.length ||
    answers.some((a, i) => {
      const values = Array.isArray(a) && group.questions[i]?.multiple ? a : [a];
      return (
        !values.length ||
        values.length > 21 ||
        values.some(
          (v) => typeof v !== "string" || !v.trim() || v.length > 4000,
        )
      );
    })
  )
    throw new Error("Answer every question with 1–4000 characters.");
  return answers.map((a) =>
    Array.isArray(a) ? [...new Set(a.map((v: string) => v.trim()))] : a.trim(),
  );
}
