import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  lstatSync,
  realpathSync,
  renameSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import type { MemoryInput, MemoryNote } from "../shared/memory";

export class FileMemory {
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true });
  }
  private safe(file: string) {
    const relative = path.relative(this.root, file);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw Error("无效的记忆路径。");
    let current = this.root;
    if (realpathSync(current) !== path.resolve(current))
      throw Error("记忆目录不能是符号链接。");
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part);
      if (existsSync(current) && lstatSync(current).isSymbolicLink())
        throw Error("记忆文件不能是符号链接。");
    }
  }
  private write(file: string, text: string) {
    this.safe(file);
    const temp = file + "." + randomUUID() + ".tmp";
    writeFileSync(temp, text, { encoding: "utf8", flag: "wx" });
    renameSync(temp, file);
  }
  directory(scope: string | null) {
    const canonical = scope ? path.resolve(scope) : null;
    const key = canonical
      ? createHash("sha256")
          .update(
            process.platform === "win32" ? canonical.toLowerCase() : canonical,
          )
          .digest("hex")
      : "global";
    const dir = path.join(this.root, key);
    this.safe(dir);
    mkdirSync(dir, { recursive: true });
    if (!existsSync(path.join(dir, ".scope.json")))
      this.write(path.join(dir, ".scope.json"), JSON.stringify(canonical));
    if (!existsSync(path.join(dir, "MEMORY.md")))
      this.write(path.join(dir, "MEMORY.md"), "# 记忆索引\n\n");
    return dir;
  }
  directories(scopes: string[]) {
    return [
      this.directory(null),
      ...new Set(scopes.map((s) => this.directory(s))),
    ];
  }
  enabled() {
    const file = path.join(this.root, "settings.json");
    this.safe(file);
    return (
      !existsSync(file) ||
      JSON.parse(readFileSync(file, "utf8")).enabled !== false
    );
  }
  setEnabled(enabled: boolean) {
    if (typeof enabled !== "boolean") throw Error("无效的自动记忆设置。");
    this.write(
      path.join(this.root, "settings.json"),
      JSON.stringify({ enabled }),
    );
  }
  private read(dir: string, name: string): MemoryNote {
    const file = path.join(dir, name);
    this.safe(file);
    if (lstatSync(file).size > 64 * 1024)
      throw Error("记忆文件超过 64 KB，请精简。");
    const raw = readFileSync(file, "utf8");
    const match = raw.match(/^<!-- anvil-memory (.*?) -->\r?\n/);
    const meta = match ? JSON.parse(match[1]) : {};
    const body = match ? raw.slice(match[0].length) : raw;
    const scopeFile = path.join(dir, ".scope.json");
    this.safe(scopeFile);
    return {
      id: path.relative(this.root, file).replaceAll("\\", "/"),
      title:
        meta.title ||
        body.match(/^#\s+(.+)$/m)?.[1] ||
        name.replace(/\.md$/, ""),
      body,
      kind: ["user", "feedback", "project", "reference"].includes(meta.kind)
        ? meta.kind
        : "reference",
      scope: JSON.parse(readFileSync(scopeFile, "utf8")),
      sourceTaskID: meta.sourceTaskID || null,
      revision: parseInt(
        createHash("sha256").update(raw).digest("hex").slice(0, 12),
        16,
      ),
      updated: lstatSync(file).mtimeMs,
    };
  }
  notes(): MemoryNote[] {
    return readdirSync(this.root, { withFileTypes: true })
      .filter(
        (d) =>
          d.isDirectory() &&
          (d.name === "global" || /^[a-f0-9]{64}$/.test(d.name)),
      )
      .flatMap((d) => {
        const dir = path.join(this.root, d.name);
        this.safe(dir);
        return readdirSync(dir)
          .filter((n) => n.endsWith(".md") && n !== "MEMORY.md")
          .map((n) => this.read(dir, n));
      });
  }
  private index(dir: string) {
    const notes = readdirSync(dir)
      .filter((n) => n.endsWith(".md") && n !== "MEMORY.md")
      .map((n) => this.read(dir, n));
    this.write(
      path.join(dir, "MEMORY.md"),
      "# 记忆索引\n\n" +
        notes
          .map(
            (n) =>
              `- [${n.title.replace(/[\r\n\[\]]/g, " ")}](${path.basename(n.id)})`,
          )
          .join("\n") +
        "\n",
    );
  }
  save(input: MemoryInput, migrationID?: string) {
    if (
      !input ||
      !input.title?.trim() ||
      input.title.length > 120 ||
      typeof input.body !== "string" ||
      !input.body.trim() ||
      input.body.length > 64000
    )
      throw Error("Invalid memory content or length.");
    if (migrationID && !/^[a-zA-Z0-9_-]{1,100}$/.test(migrationID))
      throw Error("无效的旧记忆标识。");
    const dir = this.directory(input.scope);
    let filename = path.join(dir, (migrationID || randomUUID()) + ".md");
    if (migrationID && existsSync(filename))
      return this.read(dir, path.basename(filename));
    if (input.id) {
      filename = path.resolve(this.root, input.id);
      this.safe(filename);
      if (
        path.dirname(filename) !== dir ||
        path.extname(filename) !== ".md" ||
        path.basename(filename) === "MEMORY.md"
      )
        throw Error("无效的记忆文件。");
      if (
        !existsSync(filename) ||
        this.read(dir, path.basename(filename)).revision !== input.revision
      )
        throw Error("Memory changed elsewhere. Refresh and try again.");
    }
    this.write(
      filename,
      "<!-- anvil-memory " +
        JSON.stringify({
          title: input.title.trim(),
          kind: input.kind,
          sourceTaskID: input.sourceTaskID,
        }) +
        " -->\n" +
        input.body.trim() +
        "\n",
    );
    this.index(dir);
    return this.read(dir, path.basename(filename));
  }
  remove(id: string, revision: number) {
    const file = path.resolve(this.root, id);
    this.safe(file);
    if (
      !existsSync(file) ||
      this.read(path.dirname(file), path.basename(file)).revision !== revision
    )
      throw Error("Memory changed elsewhere. Refresh and try again.");
    unlinkSync(file);
    this.index(path.dirname(file));
  }
  indexes(scopes: string[]) {
    return this.directories(scopes).map((dir) => {
      const file = path.join(dir, "MEMORY.md");
      this.safe(file);
      if (lstatSync(file).size > 1024 * 1024)
        throw Error("记忆索引过大，请精简。");
      return {
        directory: dir,
        index: readFileSync(file, "utf8")
          .split("\n")
          .slice(0, 200)
          .join("\n")
          .slice(0, 12000),
      };
    });
  }
}
