export type BrowserRuntime = { command: string[]; outputDir: string };

export function browserConfig(browser?: BrowserRuntime) {
  if (!browser) return {};
  return {
    mcp: {
      servers: {
        anvil_browser: {
          type: "local",
          command: [...browser.command, browser.outputDir],
          environment: { ELECTRON_RUN_AS_NODE: "1" },
          codemode: false,
        },
      },
    },
  };
}
