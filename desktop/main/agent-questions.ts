import type { AgentQuestionGroup } from "../shared/api";

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
        ...(q.options?.length ? { options: [...q.options] } : {}),
      };
    }),
  };
}
export function validateQuestionAnswers(
  group: AgentQuestionGroup,
  answers: unknown,
): string[] {
  if (
    !Array.isArray(answers) ||
    answers.length !== group.questions.length ||
    answers.some((a) => typeof a !== "string" || !a.trim() || a.length > 4000)
  )
    throw new Error("Answer every question with 1–4000 characters.");
  return answers.map((a) => a.trim());
}
