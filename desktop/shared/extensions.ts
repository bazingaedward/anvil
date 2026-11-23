export const builtins = ["playwright", "github", "review-pr"] as const;
export type Builtin = (typeof builtins)[number];
export type SkillFile = { path: string; text: string };
export type Skill = {
  source?: string;
  id: string;
  files: SkillFile[];
  enabled: boolean;
};
export type Binding = { repo: string; login: string; auth: "cli" | "keygrant" };
export type Extensions = {
  enabled: Builtin[];
  skills: Skill[];
  bindings: Binding[];
};
export const defaultExtensions: Extensions = {
  enabled: ["playwright"],
  skills: [],
  bindings: [],
};
export const loginPattern = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i;
export const repoPattern = /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/;
export const pinnedSource =
  /^https:\/\/github\.com\/([\w-]+\/[\w.-]+)\/tree\/([a-f0-9]{40})\/([\w.-]+(?:\/[\w.-]+)*)$/;
const commandPattern = /^[a-z0-9][a-z0-9-]{0,47}$/;
const record = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).every((k) => keys.includes(k));
function unique(values: unknown[]) {
  return new Set(values).size === values.length;
}
export function validSkillPath(path: string) {
  return (
    path.length <= 180 &&
    path.split("/").every((p) => /^[\w-][\w. -]*$/.test(p)) &&
    /\.(md|txt|json|yaml|yml|toml|csv|ts|js|py|sh)$/i.test(path)
  );
}
export function validateExtensions(v: unknown): Extensions {
  if (
    !record(v, ["enabled", "skills", "bindings"]) ||
    !Array.isArray(v.enabled) ||
    !v.enabled.every((id) => builtins.includes(id)) ||
    !unique(v.enabled) ||
    !Array.isArray(v.skills) ||
    v.skills.length > 64 ||
    !Array.isArray(v.bindings) ||
    v.bindings.length > 256 ||
    new TextEncoder().encode(JSON.stringify(v)).length > 180000
  )
    throw Error("扩展配置格式或大小无效。");
  for (const s of v.skills) {
    if (
      !record(s, ["id", "files", "enabled", "source"]) ||
      typeof s.id !== "string" ||
      !commandPattern.test(s.id) ||
      s.id === "pr-review" ||
      (s.source !== undefined &&
        (typeof s.source !== "string" || !pinnedSource.test(s.source))) ||
      builtins.some((id) => id === s.id) ||
      typeof s.enabled !== "boolean" ||
      !Array.isArray(s.files) ||
      s.files.length > 64 ||
      !s.files.every(
        (f) =>
          record(f, ["path", "text"]) &&
          typeof f.path === "string" &&
          validSkillPath(f.path) &&
          typeof f.text === "string" &&
          !f.text.includes("\0"),
      ) ||
      !s.files.some((f) => f.path === "SKILL.md" && f.text.trim()) ||
      !unique(s.files.map((f) => f.path))
    )
      throw Error("Skill 名称、文件或内容无效。");
  }
  for (const b of v.bindings) {
    if (
      !record(b, ["repo", "login", "auth"]) ||
      typeof b.repo !== "string" ||
      !repoPattern.test(b.repo) ||
      typeof b.login !== "string" ||
      !loginPattern.test(b.login) ||
      !["cli", "keygrant"].includes(String(b.auth))
    )
      throw Error("GitHub 仓库绑定无效。");
  }
  if (
    !unique(v.skills.map((s) => s.id)) ||
    !unique(v.bindings.map((b) => b.repo))
  )
    throw Error("扩展名称或仓库绑定重复。");
  return v as Extensions;
}

export function githubKey(login: string) {
  return "ANVIL_GITHUB_" + login.toUpperCase().replaceAll("-", "_");
}
