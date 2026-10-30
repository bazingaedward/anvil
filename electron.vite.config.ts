import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  main: {
    build: { rollupOptions: { input: resolve("desktop/main/index.ts") } },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve("desktop/preload/index.ts"),
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
  },
  renderer: {
    root: resolve("desktop/renderer"),
    plugins: [react()],
    build: { rollupOptions: { input: resolve("desktop/renderer/index.html") } },
  },
});
