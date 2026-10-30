import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import {
  lstat,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  Change,
  DiffDocument,
  DiffSide,
  FileDocument,
  RepoState,
} from "../shared/api";

const MAX_TEXT = 2 * 1024 * 1024;
const version = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");

export function git(root: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["--no-pager", "-C", root, ...args],
      {
        encoding: "buffer",
        maxBuffer: 8 * 1024 * 1024,
        timeout: 15_000,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: "0",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
          reject(
            new Error(
              missing
                ? "Git was not found. Install Git, then reopen Anvil."
                : stderr.toString().trim() || error.message,
            ),
          );
        } else resolve(stdout);
      },
    );
  });
}

export function parseStatus(data: Buffer): Change[] {
  const fields = data.toString("utf8").split("\0");
  const changes: Change[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    const item: Change = {
      index: field[0],
      worktree: field[1],
      path: field.slice(3),
    };
    if (/[RC]/.test(item.index + item.worktree))
      item.originalPath = fields[++i];
    changes.push(item);
  }
  return changes;
}

export class Workspace {
  private constructor(readonly root: string) {}

  static async open(directory: string) {
    const selected = await realpath(directory);
    // Resolve the root via Git so opening a subdirectory still opens its repository.
    const root = (await git(selected, ["rev-parse", "--show-toplevel"]))
      .toString()
      .trimEnd();
    return new Workspace(await realpath(root));
  }

  async status(): Promise<RepoState> {
    const [raw, branch] = await Promise.all([
      git(this.root, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]),
      git(this.root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() =>
        git(this.root, ["rev-parse", "--short", "HEAD"]),
      ),
    ]);
    return {
      root: this.root,
      name: path.basename(this.root),
      branch: branch.toString().trim(),
      changes: parseStatus(raw),
    };
  }

  private async resolve(relative: string) {
    if (
      typeof relative !== "string" ||
      relative.includes("\0") ||
      path.isAbsolute(relative)
    )
      throw new Error("Invalid workspace path.");
    const target = path.resolve(this.root, relative || ".");
    const inside = path.relative(this.root, target);
    if (
      inside === ".." ||
      inside.startsWith(`..${path.sep}`) ||
      path.isAbsolute(inside)
    )
      throw new Error("Path is outside the repository.");
    let cursor = this.root;
    for (const segment of inside.split(path.sep).filter(Boolean)) {
      if (segment.toLowerCase() === ".git")
        throw new Error("Git internals cannot be edited here.");
      cursor = path.join(cursor, segment);
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink())
        throw new Error("Symbolic links are not opened by the editor.");
    }
    return target;
  }

  async list(relative: string) {
    const directory = await this.resolve(relative);
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.length > 3000)
      throw new Error(
        "This folder has more than 3,000 entries. Use the terminal to explore it.",
      );
    return entries
      .filter((entry) => entry.name !== ".git")
      .map((entry) => ({
        name: entry.name,
        path: relative ? `${relative}/${entry.name}` : entry.name,
        directory: entry.isDirectory(),
        symlink: entry.isSymbolicLink(),
      }))
      .sort(
        (a, b) =>
          Number(b.directory) - Number(a.directory) ||
          a.name.localeCompare(b.name),
      );
  }

  private decode(data: Buffer) {
    if (data.length > MAX_TEXT)
      throw new Error(
        "Files larger than 2 MiB are not opened in this preview.",
      );
    if (data.includes(0) || !isUtf8(data))
      throw new Error(
        "Binary or non-UTF-8 file. Use the terminal or an external editor.",
      );
    return data.toString("utf8");
  }

  async read(relative: string): Promise<FileDocument> {
    const target = await this.resolve(relative);
    const stat = await lstat(target);
    if (!stat.isFile()) throw new Error("This entry is not a regular file.");
    if (stat.size > MAX_TEXT)
      throw new Error(
        "Files larger than 2 MiB are not opened in this preview.",
      );
    const data = await readFile(target);
    return {
      path: relative,
      content: this.decode(data),
      version: version(data),
    };
  }

  async save(document: FileDocument) {
    if (
      !document ||
      typeof document.content !== "string" ||
      typeof document.version !== "string"
    )
      throw new Error("Invalid save request.");
    if (Buffer.byteLength(document.content) > MAX_TEXT)
      throw new Error("File exceeds the 2 MiB editor limit.");
    const current = await this.read(document.path);
    if (current.version !== document.version)
      throw new Error(
        "This file changed on disk. Your edits are still here. Reload the file to review the disk version before saving.",
      );
    // Revalidate immediately before writing; this detects stale reads, not a filesystem lock.
    const target = await this.resolve(document.path);
    await writeFile(target, document.content, "utf8");
    return { ...document, version: version(Buffer.from(document.content)) };
  }

  private async blob(tree: "HEAD" | "", relative: string): Promise<Buffer> {
    // ls-tree / ls-files first distinguishes an absent path from a failing Git read.
    const args = tree
      ? ["ls-tree", "-z", tree, "--", relative]
      : ["ls-files", "--stage", "-z", "--", `:(literal)${relative}`];
    const records = (await git(this.root, args))
      .toString()
      .split("\0")
      .filter(Boolean);
    const record = records.find(
      (value) => value.slice(value.indexOf("\t") + 1) === relative,
    );
    if (!record) return Buffer.alloc(0);
    const [mode, second, third] = record
      .slice(0, record.indexOf("\t"))
      .split(" ");
    if (mode === "160000")
      throw new Error("Submodule changes are available in the terminal.");
    if (mode === "120000")
      throw new Error("Symbolic link changes are available in the terminal.");
    if (!tree && third !== "0")
      throw new Error(
        "This file has merge conflicts. Resolve them in the editor or terminal.",
      );
    const oid = tree ? third : second;
    const size = Number(
      (await git(this.root, ["cat-file", "-s", oid])).toString(),
    );
    if (size > MAX_TEXT)
      throw new Error(
        "Files larger than 2 MiB are not opened in this preview.",
      );
    return git(this.root, ["cat-file", "blob", oid]);
  }

  async diff(relative: string, side: DiffSide): Promise<DiffDocument> {
    if (side !== "worktree" && side !== "index")
      throw new Error("Invalid diff selection.");
    const change = (await this.status()).changes.find(
      (item) => item.path === relative,
    );
    if (!change)
      throw new Error(
        "This file is no longer changed. Refresh the changes list.",
      );
    if (
      change.index === "U" ||
      change.worktree === "U" ||
      ["AA", "DD"].includes(change.index + change.worktree)
    ) {
      throw new Error(
        "Merge conflict. Open the file from Explorer to resolve it, then use the terminal to stage it.",
      );
    }
    let original: Buffer;
    let modified: Buffer;
    if (side === "index") {
      const hasHead = await git(this.root, [
        "rev-parse",
        "--verify",
        "HEAD",
      ]).then(
        () => true,
        () => false,
      );
      original = hasHead
        ? await this.blob("HEAD", change.originalPath || relative)
        : Buffer.alloc(0);
      modified = await this.blob("", relative);
    } else {
      original = await this.blob("", relative);
      modified =
        change.worktree === "D"
          ? Buffer.alloc(0)
          : Buffer.from((await this.read(relative)).content);
    }
    return {
      path: relative,
      original: this.decode(original),
      modified: this.decode(modified),
    };
  }
}
