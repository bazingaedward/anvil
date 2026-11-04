import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Format conversion only: retain the approved artwork and its transparency.
if (process.platform !== "darwin")
  throw new Error("Icon regeneration requires macOS sips and iconutil.");
const assets = fileURLToPath(new URL("../assets/", import.meta.url));
const source = path.join(assets, "anvil-source.png");
const temp = mkdtempSync(path.join(os.tmpdir(), "anvil-icons-"));
const resize = (size, destination) =>
  execFileSync(
    "sips",
    ["-z", String(size), String(size), source, "--out", destination],
    {
      stdio: "ignore",
    },
  );
try {
  resize(1024, path.join(assets, "icon.png"));
  const iconset = path.join(temp, "Anvil.iconset");
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    resize(size, path.join(iconset, `icon_${size}x${size}.png`));
    resize(size * 2, path.join(iconset, `icon_${size}x${size}@2x.png`));
  }
  execFileSync("iconutil", [
    "-c",
    "icns",
    iconset,
    "-o",
    path.join(assets, "icon.icns"),
  ]);

  // ICO directory entries can contain PNG frames on supported Windows versions.
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  const images = [];
  let offset = header.length;
  for (const [index, size] of sizes.entries()) {
    const file = path.join(temp, `${size}.png`);
    resize(size, file);
    const data = readFileSync(file);
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
    images.push(data);
  }
  writeFileSync(
    path.join(assets, "icon.ico"),
    Buffer.concat([header, ...images]),
  );
  console.log("Generated assets/icon.png, icon.icns and icon.ico");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
