import { git, Workspace } from "./workspace";
import type { ReviewHistory, ReviewOptions } from "../shared/api";
export async function reviewHistory(
  root: string,
  limit: number,
  options: ReviewOptions = {},
): Promise<ReviewHistory> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("Invalid history limit.");
  if (
    !options ||
    typeof options !== "object" ||
    (options.branch !== undefined && typeof options.branch !== "string")
  )
    throw new Error("Invalid history options.");
  if (!(await Workspace.open(root).then((w) => w.status())).git)
    throw new Error("Open the repository root to review Git history.");
  const branches = (
    await git(root, [
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads",
      "refs/remotes",
    ])
  )
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  if (options.branch && !branches.includes(options.branch))
    throw new Error("Unknown branch.");
  const refs = options.branch
    ? [options.branch]
    : [
        "--branches",
        "--tags",
        ...(options.remotes !== false ? ["--remotes"] : []),
      ];
  if (options.stash) {
    const stash = await git(root, [
      "rev-parse",
      "--verify",
      "refs/stash",
    ]).catch(() => null);
    if (stash) refs.push("refs/stash");
  }
  const head = await git(root, ["rev-parse", "--verify", "HEAD"]).catch(
    () => null,
  );
  if (!head && !branches.length) return { commits: [], branches };
  if (!options.branch && head) refs.push("HEAD");
  const raw = (
    await git(root, [
      "log",
      "--topo-order",
      "--date=iso-strict",
      `--max-count=${limit}`,
      "--format=%H%x1f%P%x1f%s%x1f%an%x1f%ad%x1f%D",
      ...refs,
      "--",
    ])
  ).toString();
  const commits = raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, parents, title, author, date, decorations = ""] =
        line.split("\x1f");
      return {
        hash,
        parents: parents.split(" ").filter(Boolean),
        title,
        author,
        date,
        refs: decorations.split(", ").filter(Boolean),
      };
    });
  return { commits, branches };
}
export async function reviewPatch(root: string, head: string, base?: string) {
  if (
    !/^[a-f0-9]{40,64}$/.test(head) ||
    (base !== undefined && !/^[a-f0-9]{40,64}$/.test(base))
  )
    throw new Error("Invalid commit ID.");
  const args = base
    ? ["diff", "--no-ext-diff", "--no-textconv", base, head, "--"]
    : [
        "show",
        "--format=fuller",
        "--first-parent",
        "--no-ext-diff",
        "--no-textconv",
        head,
        "--",
      ];
  return (await git(root, args)).toString();
}
