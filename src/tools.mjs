import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { runProcess } from "./process.mjs";

const MAX_FILE = 128_000;
const hash = (text) => createHash("sha256").update(text).digest("hex");
const blocked = (part) => [".git", ".anvil", "node_modules"].includes(part)
  || part === ".env" || part.startsWith(".env.") || /\.(pem|key)$/i.test(part);
const definition = (name, description, properties) => ({ name, description,
  parameters: { type: "object", properties: Object.fromEntries(Object.entries(properties)
    .map(([key, description]) => [key, { type: "string", description }])),
  required: Object.keys(properties), additionalProperties: false } });

export const toolDefinitions = [
  definition("list_files", "List repository files using ripgrep and its ignore rules.", {}),
  definition("search", "Search repository text for a literal string; respects ripgrep ignore rules.", { query: "Literal text to find" }),
  definition("read_file", "Read a UTF-8 file before editing it. Maximum 128 KB.", { path: "Repository-relative file path" }),
  definition("edit_file", "Replace one exact, unique text occurrence in a previously read file. Requires approval.", {
    path: "Repository-relative file path", old_text: "Exact nonempty text occurring once", new_text: "Replacement text" }),
  definition("create_file", "Create a new UTF-8 file in an existing directory; never overwrite. Requires approval.", {
    path: "Repository-relative file path", content: "Complete new file content" }),
  definition("run_command", "Run a shell command in the repository after approval. Use relevant tests; do not commit, push, deploy, or discard user changes.", {
    command: "Shell command to run" }),
];

export async function createTools({ root, approve = async () => false, signal, timeoutMs = 30_000 }) {
  root = await realpath(root);
  const snapshots = new Map();
  const changed = new Set();

  async function resolveFile(relative, creating = false) {
    if (!relative || path.isAbsolute(relative)) throw new Error("Use a repository-relative file path.");
    const parts = relative.split(/[\\/]/);
    if (parts.some((part) => part === ".." || blocked(part))) throw new Error("Path is outside the allowed file scope.");
    const target = path.resolve(root, relative);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Path must refer to a file inside the repository.");
    let current = root;
    for (const part of path.relative(root, target).split(path.sep)) {
      current = path.join(current, part);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) throw new Error("Symbolic links are not supported by file tools.");
        if (current === target && (!info.isFile() || info.nlink > 1)) throw new Error("Expected a regular file without hard links.");
      } catch (error) {
        if (creating && error.code === "ENOENT" && current === target) break;
        throw error;
      }
    }
    return target;
  }

  async function read(target) {
    if ((await lstat(target)).size > MAX_FILE) throw new Error("File exceeds the 128 KB limit.");
    const buffer = await readFile(target);
    if (buffer.length > MAX_FILE || buffer.includes(0)) throw new Error("File is too large or is binary.");
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  }

  async function execute(name, args) {
    try {
      signal?.throwIfAborted();
      const spec = toolDefinitions.find((item) => item.name === name);
      if (!spec) throw new Error("Unknown tool.");
      const keys = Object.keys(spec.parameters.properties);
      if (!args || Array.isArray(args) || typeof args !== "object"
        || Object.keys(args).length !== keys.length || keys.some((key) => typeof args[key] !== "string")) {
        throw new Error("Tool arguments do not match the declared schema.");
      }
      if (name === "list_files" || name === "search") {
        if (name === "search" && !args.query) throw new Error("Search query must not be empty.");
        const globs = ["!.git", "!.anvil", "!node_modules", "!.env", "!.env.*", "!*.pem", "!*.key"];
        return await runProcess("rg", [...(name === "list_files" ? ["--files"] : ["-n", "-F", "--max-count", "20"]),
          "--hidden", "--color", "never", ...globs.flatMap((glob) => ["-g", glob]),
          ...(name === "search" ? ["--", args.query, "."] : [])], { cwd: root, signal, timeoutMs });
      }
      if (name === "run_command") {
        if (!args.command.trim()) throw new Error("Command must not be empty.");
        if (!await approve({ name, args })) return { denied: true };
        return await runProcess("/bin/sh", ["-c", args.command], { cwd: root, signal, timeoutMs });
      }
      const target = await resolveFile(args.path, name === "create_file");
      if (name === "read_file") {
        const text = await read(target);
        snapshots.set(target, hash(text));
        return { content: text };
      }
      let next = args.content;
      let expected;
      if (name === "edit_file") {
        const current = await read(target);
        expected = snapshots.get(target);
        if (!expected || hash(current) !== expected) throw new Error("Read the current file again before editing; it is unread or has changed.");
        if (!args.old_text || current.split(args.old_text).length !== 2) throw new Error("old_text must match exactly once.");
        next = current.replace(args.old_text, () => args.new_text);
      }
      if (Buffer.byteLength(next) > MAX_FILE) throw new Error("New content exceeds the 128 KB limit.");
      if (!await approve({ name, args })) return { denied: true };
      signal?.throwIfAborted();
      await resolveFile(args.path, name === "create_file");
      if (name === "edit_file" && hash(await read(target)) !== expected) throw new Error("File changed during approval; read it again.");
      await writeFile(target, next, { flag: name === "create_file" ? "wx" : "w" });
      snapshots.set(target, hash(next));
      changed.add(path.relative(root, target));
      return { edited: path.relative(root, target) };
    } catch (error) {
      if (signal?.aborted) return { cancelled: true };
      return { error: error.code ? `File operation failed: ${error.code}` : error.message };
    }
  }

  return { root, definitions: toolDefinitions, execute, changed };
}
