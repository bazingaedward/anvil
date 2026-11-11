import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { git, Workspace } from "./workspace";
import type {
  ReviewCommit,
  ReviewSearch,
  ReviewHistory,
  ReviewOptions,
} from "../shared/api";
async function historyScope(root: string, options: ReviewOptions = {}) {
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
  if (!head && !branches.length) return { refs: [], branches };
  if (!options.branch && head) refs.push("HEAD");
  return { refs, branches };
}
const format = "--format=%H%x1f%P%x1f%s%x1f%an%x1f%ad%x1f%D";
function parseCommit(line: string): ReviewCommit {
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
}
export async function reviewHistory(
  root: string,
  limit: number,
  options: ReviewOptions = {},
): Promise<ReviewHistory> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("Invalid history limit.");
  const { refs, branches } = await historyScope(root, options);
  if (options.commit && !/^[a-f0-9]{40,64}$/.test(options.commit))
    throw new Error("Invalid commit ID.");
  if (!refs.length) return { commits: [], branches };
  const raw = (
    await git(root, [
      "log",
      "--topo-order",
      "--date=iso-strict",
      `--max-count=${limit}`,
      format,
      ...(options.commit ? [options.commit] : refs),
      "--",
    ])
  ).toString();
  return {
    commits: raw.trim().split("\n").filter(Boolean).map(parseCommit),
    branches,
  };
}
export async function searchHistory(
  root: string,
  query: string,
  cursor = 0,
  options: ReviewOptions = {},
): Promise<ReviewSearch> {
  if (
    typeof query !== "string" ||
    query.length > 200 ||
    !Number.isSafeInteger(cursor) ||
    cursor < 0
  )
    throw new Error("Invalid search request.");
  const needle = query.trim().toLowerCase();
  const { refs } = await historyScope(root, options);
  if (!needle || !refs.length) return { commits: [], next: null };
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      [
        "--no-pager",
        "-C",
        root,
        "log",
        "--topo-order",
        "--date=iso-strict",
        `--skip=${cursor}`,
        format,
        ...refs,
        "--",
      ],
      {
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const lines = createInterface({ input: child.stdout });
    const commits: ReviewCommit[] = [];
    let scanned = cursor,
      settled = false,
      stderr = "";
    const finish = (error?: Error, next: number | null = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.kill();
      if (error) reject(error);
      else resolve({ commits, next });
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error("History search timed out. Narrow your branch selection."),
        ),
      15_000,
    );
    child.stderr.on("data", (data) => {
      stderr = (stderr + data.toString()).slice(-2000);
    });
    child.on("error", () =>
      finish(new Error("Could not start Git history search.")),
    );
    child.on("close", (code) =>
      finish(
        code === 0
          ? undefined
          : new Error(stderr.trim() || "History search failed."),
      ),
    );
    lines.on("line", (line) => {
      if (settled) return;
      const commit = parseCommit(line);
      const matches = [
        commit.title,
        commit.author,
        commit.hash,
        ...commit.refs,
      ].some((value) => value.toLowerCase().includes(needle));
      if (matches && commits.length === 50) {
        finish(undefined, scanned);
        return;
      }
      scanned++;
      if (matches) commits.push(commit);
    });
  });
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

export async function fetchRemotes(root: string): Promise<void> {
  if (!(await Workspace.open(root).then((workspace) => workspace.status())).git)
    throw new Error("Open the repository root to fetch remotes.");
  if (!(await git(root, ["remote"])).toString().trim())
    throw new Error("No remotes configured for this repository.");
  await git(
    root,
    ["fetch", "--all", "--no-prune", "--no-recurse-submodules"],
    120_000,
  );
}
