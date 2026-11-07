import { modelBaseURL, protocols } from "../shared/providers";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import type { Attachment, ModelProfile } from "../shared/api";
export const defaultModel: ModelProfile = {
  id: "ark-default",
  name: "DeepSeek",
  model: "deepseek-v4-1-flash-261017",
  provider: "BytePlus Ark",
  endpoint: "",
  keyRef: "BYTEPLUS_ARK_API_KEY",
  vision: false,
};
export type StoredAttachment = Attachment & { content: string };
export function validateModel(value: ModelProfile): ModelProfile {
  if (!value || typeof value !== "object")
    throw new Error("Invalid model configuration.");
  for (const field of ["id", "name", "model", "provider", "keyRef"] as const)
    if (
      typeof value[field] !== "string" ||
      !value[field].trim() ||
      value[field].length > 160
    )
      throw new Error(`Invalid ${field}.`);
  if (
    !/^[a-zA-Z0-9_-]+$/.test(value.id) ||
    !/^[A-Z][A-Z0-9_]*$/.test(value.keyRef)
  )
    throw new Error("Use a model ID and a Keygrant environment variable name.");
  if (value.protocol !== undefined && !protocols.includes(value.protocol))
    throw new Error("Unsupported model protocol.");
  if (value.endpoint !== "" || value.id !== "ark-default")
    modelBaseURL(value.endpoint, value.protocol || "responses");
  for (const field of ["contextLimit", "outputLimit"] as const)
    if (
      value[field] !== undefined &&
      (!Number.isSafeInteger(value[field]) ||
        value[field]! < 256 ||
        value[field]! > 10000000)
    )
      throw new Error("Invalid model token limit.");
  if (
    value.outputLimit &&
    value.contextLimit &&
    value.outputLimit > value.contextLimit
  )
    throw new Error("Output limit exceeds context limit.");
  if (value.tools !== undefined && typeof value.tools !== "boolean")
    throw new Error("Invalid tool capability.");
  return {
    id: value.id,
    name: value.name.trim(),
    model: value.model.trim(),
    provider: value.provider.trim(),
    endpoint: value.endpoint,
    keyRef: value.keyRef,
    vision: value.vision === true,
    ...(value.protocol !== undefined ? { protocol: value.protocol } : {}),
    ...(value.contextLimit !== undefined
      ? { contextLimit: value.contextLimit }
      : {}),
    ...(value.outputLimit !== undefined
      ? { outputLimit: value.outputLimit }
      : {}),
    ...(value.tools !== undefined ? { tools: value.tools } : {}),
  };
}
export class ComposerStore {
  constructor(private root: string) {
    mkdirSync(path.join(root, "attachments"), { recursive: true });
  }
  models(): ModelProfile[] {
    const file = path.join(this.root, "models.json");
    if (!existsSync(file)) return [{ ...defaultModel }];
    const values = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(values))
      throw new Error("Invalid models configuration file.");
    return values.map(validateModel);
  }
  private save(values: ModelProfile[]) {
    const file = path.join(this.root, "models.json");
    writeFileSync(file + ".tmp", JSON.stringify(values, null, 2));
    renameSync(file + ".tmp", file);
    return values;
  }
  replaceProfiles(values: ModelProfile[]) {
    if (!values.length) throw new Error("Keep at least one model.");
    return this.save(values.map(validateModel));
  }
  put(value: ModelProfile) {
    const profile = validateModel(value),
      values = this.models();
    return this.save([...values.filter((v) => v.id !== profile.id), profile]);
  }
  remove(id: string) {
    const values = this.models().filter((v) => v.id !== id);
    if (!values.length) throw new Error("Keep at least one model.");
    return this.save(values);
  }
  model(id?: string) {
    const model = this.models().find((v) => v.id === (id || "ark-default"));
    if (!model) throw new Error("Select a configured model.");
    return model;
  }
  attach(name: string, bytes: Uint8Array): Attachment {
    if (
      typeof name !== "string" ||
      !name ||
      name.length > 255 ||
      !(bytes instanceof Uint8Array) ||
      !bytes.length ||
      bytes.length > 5 * 1024 * 1024
    )
      throw new Error("Attachments must be non-empty and at most 5 MB.");
    const data = Buffer.from(bytes);
    const hex = data.subarray(0, 12).toString("hex");
    const mime = hex.startsWith("89504e470d0a1a0a")
      ? "image/png"
      : hex.startsWith("ffd8ff")
        ? "image/jpeg"
        : data
              .subarray(0, 6)
              .toString()
              .match(/^GIF8[79]a$/)
          ? "image/gif"
          : data.subarray(0, 4).toString() === "RIFF" &&
              data.subarray(8, 12).toString() === "WEBP"
            ? "image/webp"
            : "text/plain";
    let content: string;
    if (mime.startsWith("image/"))
      content = `data:${mime};base64,${data.toString("base64")}`;
    else {
      if (
        data.length > 256 * 1024 ||
        data.includes(0) ||
        data.subarray(0, 5).toString() === "%PDF-"
      )
        throw new Error(
          "Use UTF-8 text files up to 256 KB, or PNG/JPEG/GIF/WebP images. PDF and binary documents are not supported yet.",
        );
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(data);
      } catch {
        throw new Error("This file is not UTF-8 text.");
      }
    }
    const attachment = {
      id: randomUUID(),
      name: path.basename(name),
      mime,
      size: data.length,
    };
    writeFileSync(
      path.join(this.root, "attachments", attachment.id + ".json"),
      JSON.stringify({ ...attachment, content }),
    );
    return attachment;
  }
  attachments(ids: string[] = []): StoredAttachment[] {
    if (
      !Array.isArray(ids) ||
      ids.length > 8 ||
      ids.some((id) => typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
    )
      throw new Error("Select up to eight valid attachments.");
    const values = [...new Set(ids)].map(
      (id) =>
        JSON.parse(
          readFileSync(
            path.join(this.root, "attachments", id + ".json"),
            "utf8",
          ),
        ) as StoredAttachment,
    );
    if (values.reduce((sum, item) => sum + item.size, 0) > 10 * 1024 * 1024)
      throw new Error("Attachments exceed the 10 MB message limit.");
    return values;
  }
}
