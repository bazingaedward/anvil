import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("a fresh conversation can submit without folders by button and keyboard", async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), "anvil-folderless-ui-"));
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (pair): pair is [string, string] => pair[1] !== undefined,
      ),
    ),
    ANVIL_TEST_USER_DATA: profile,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.BYTEPLUS_ARK_API_KEY;
  delete env.BYTEPLUS_ARK_RESPONSES_URL;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    const input = page.getByRole("textbox", { name: "Message Anvil" });
    const send = page.getByRole("button", { name: "Send message" });
    await expect(page.getByLabel("Attached folders")).toHaveText("0");
    await expect(send).toBeDisabled();
    await input.fill("Hello without a project");
    await expect(send).toBeEnabled();
    await send.click();
    // The real IPC reaches the executor's runtime/credential check, not a folder gate.
    const notice = page.locator(".draft-notice");
    await expect(notice).toContainText(
      /Agent runtime is not installed|Start Anvil through keygrant/,
    );
    await page.reload();
    await expect(input).toHaveValue("Hello without a project");
    await expect(page.getByLabel("Attached folders")).toHaveText("0");
    await expect(notice).toHaveText("Ctrl / ⌘ + Enter to send");
    await input.press(
      process.platform === "darwin" ? "Meta+Enter" : "Control+Enter",
    );
    await expect(notice).toContainText(
      /Agent runtime is not installed|Start Anvil through keygrant/,
    );
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
