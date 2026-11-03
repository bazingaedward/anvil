import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

// Only unambiguous file operations qualify. Shell/MCP/search patterns still ask.
export function allowsFolderOperation(
  action: string,
  resources: unknown[],
  cwd: string,
  folders: string[],
) {
  if (!["read", "edit"].includes(action) || !resources.length) return false;
  return resources.every((resource) => {
    if (typeof resource !== "string" || !resource || /[*?\x00]/.test(resource))
      return false;
    const target = path.resolve(cwd, resource);
    if (
      process.platform === "win32" &&
      target.slice(path.parse(target).root.length).includes(":")
    )
      return false;
    return folders.some((folder) => {
      const relative = path.relative(folder, target);
      if (
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      )
        return false;
      try {
        if (realpathSync(folder) !== folder) return false;
        let current = folder;
        for (const part of relative.split(path.sep).filter(Boolean)) {
          current = path.join(current, part);
          try {
            if (lstatSync(current).isSymbolicLink()) return false;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT")
              return false;
          }
        }
        return true;
      } catch {
        return false;
      }
    });
  });
}

// Conservative local policy: unknown actions and command strings require review.
export function allowsOperation(
  mode: string | undefined,
  action: string,
  resources: unknown[],
  cwd: string,
  folders: string[],
) {
  if (mode === "full") return true;
  if (mode !== undefined && mode !== "ask" && mode !== "auto") return false;
  if (action !== "read" && !(mode === "auto" && action === "edit"))
    return false;
  return allowsFolderOperation(action, resources, cwd, folders);
}
