import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { git } from "../../desktop/main/workspace";

test("real desktop opens, saves safely, reviews both diffs and runs a PTY", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anvil-ui-"));
  const profile = await mkdtemp(path.join(os.tmpdir(), "anvil-profile-"));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Anvil Test"]);
  await git(root, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(root, "hello.ts"), "export const hello = 1;\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "fixture"]);
  await writeFile(path.join(root, "hello.ts"), "export const hello = 2;\n");
  await git(root, ["add", "hello.ts"]);
  await writeFile(path.join(root, "hello.ts"), "export const hello = 3;\n");
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (pair): pair is [string, string] => pair[1] !== undefined,
      ),
    ),
    ANVIL_TEST_USER_DATA: profile,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...(process.env.ANVIL_ELECTRON_PATH
      ? { executablePath: process.env.ANVIL_ELECTRON_PATH, args: [] }
      : { args: ["."] }),
    env,
  });
  let page;
  const terminalOutput: string[] = [];
  try {
    page = await app.firstWindow();
    // Capture only this fixture's PTY traffic to diagnose platform-specific failures.
    await app.evaluate(({ ipcMain }) => {
      const state = globalThis as unknown as { anvilTestInput: string[] };
      state.anvilTestInput = [];
      ipcMain.on("terminal:input", (_event, data) =>
        state.anvilTestInput.push(data),
      );
    });
    await page.exposeFunction("recordTestTerminal", (data: string) =>
      terminalOutput.push(data),
    );
    await page.evaluate(() => {
      window.anvil.onTerminal((event) => {
        if (event.type === "data")
          (
            window as unknown as { recordTestTerminal: (data: string) => void }
          ).recordTestTerminal(event.data);
      });
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    page.on("console", (event) => {
      if (event.type() === "error") console.error(event.text());
    });
    await expect(
      page.getByRole("heading", { name: "What are we working on?" }),
    ).toBeVisible();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, root);
    await page
      .getByRole("button", { name: "Open repository", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("main", { name: "Conversation", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send message" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("region", { name: "Terminal", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "Message Anvil" })
      .fill("Fix the failing tests without changing the public API.");
    await page.screenshot({ path: "test-results/conversation-workspace.png" });
    await page.getByRole("button", { name: "Open files", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "hello.ts", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "hello.ts", exact: true }).click();
    await expect(page.locator(".monaco-editor").first()).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Message Anvil" }),
    ).toHaveValue("Fix the failing tests without changing the public API.");
    const input = page.locator(".monaco-editor textarea").first();
    await page.locator(".monaco-editor .view-lines").first().click();
    await input.focus();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+A" : "Control+A",
    );
    await page.keyboard.insertText("export const hello = 4;\n");
    await expect(page.getByRole("button", { name: "Save file" })).toBeEnabled();
    await page.getByRole("button", { name: "Save file" }).click();
    await expect
      .poll(() => readFile(path.join(root, "hello.ts"), "utf8"))
      .toBe("export const hello = 4;\n");
    expect((await git(root, ["show", ":hello.ts"])).toString()).toBe(
      "export const hello = 2;\n",
    );
    // A concurrent disk edit must remain untouched; the unsaved buffer stays visible.
    await input.focus();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+A" : "Control+A",
    );
    await page.keyboard.insertText("export const hello = 5;\n");
    await page.getByRole("button", { name: "Close review panel" }).click();
    await expect(
      page.getByRole("textbox", { name: "Message Anvil" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open files", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save file" })).toBeEnabled();
    await expect(
      page.locator(".monaco-editor .view-lines").first(),
    ).toContainText("hello = 5");
    await writeFile(path.join(root, "hello.ts"), "external edit\n");
    await page.getByRole("button", { name: "Save file" }).click();
    await expect(page.locator(".error-banner")).toContainText(
      "changed on disk",
    );
    expect(await readFile(path.join(root, "hello.ts"), "utf8")).toBe(
      "external edit\n",
    );
    // Keep editing is the default response; attempts to navigate must preserve the buffer.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 0,
        checkboxChecked: false,
      });
    });
    await page
      .getByRole("button", { name: /Changes/ })
      .first()
      .click();
    await page.locator(".change-row").first().click();
    await expect(page.getByRole("button", { name: "Save file" })).toBeEnabled();
    // Explicit discard permits inspecting the index and worktree separately.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    await page.getByRole("button", { name: "Dismiss error" }).click();
    await page.getByRole("button", { name: "Back to file list" }).click();
    await page.locator(".change-row").first().click();
    await expect(page.locator(".monaco-diff-editor")).toBeVisible();
    await expect(page.locator(".diff-label")).toHaveText(
      "Index ↔ Working tree",
    );
    await page.getByRole("button", { name: "Back to file list" }).click();
    await page.locator(".change-row").nth(1).click();
    await expect(page.locator(".diff-label")).toHaveText("HEAD ↔ Index");
    await expect(page.locator(".error-banner")).toHaveCount(0);
    // Exercise the actual native PTY and its cwd, rather than a mocked terminal API.
    const output = path.join(root, "terminal-proof.txt");
    const command =
      process.platform === "win32"
        ? "Set-Content -LiteralPath terminal-proof.txt -Value ANVIL_PTY_OK -NoNewline\r"
        : "printf ANVIL_PTY_OK > terminal-proof.txt\r";
    await page.getByRole("button", { name: "Toggle terminal" }).click();
    const terminalInput = page.locator(".xterm-helper-textarea");
    const terminalBody = page.locator(".terminal-body");
    await expect(terminalBody).toContainText(
      process.platform === "win32" ? />\s*$/ : /[$%➜❯]/,
      { timeout: 30_000 },
    );
    await terminalInput.focus();
    await page.keyboard.insertText(command.trimEnd());
    // The renderer dispatches input before the native shell finishes processing it.
    await expect
      .poll(async () =>
        (await terminalBody.innerText()).replace(/\s/g, ""),
      )
      .toContain(command.replace(/\s/g, ""));
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => readFile(output, "utf8").catch(() => ""), {
        timeout: 15_000,
      })
      .toBe("ANVIL_PTY_OK");
    await page.screenshot({ path: "test-results/desktop-workspace.png" });
    // Reopening the same repository must not silently kill its terminal.
    await page
      .getByRole("button", { name: "Open repository", exact: true })
      .first()
      .click();
    await rm(output);
    await terminalInput.focus();
    await page.keyboard.insertText(command.trimEnd());
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => readFile(output, "utf8").catch(() => ""), {
        timeout: 15_000,
      })
      .toBe("ANVIL_PTY_OK");
    await expect(
      page.getByRole("textbox", { name: "Message Anvil" }),
    ).toHaveValue("Fix the failing tests without changing the public API.");
    await page
      .getByRole("button", { name: "New conversation", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Message Anvil" }),
    ).toHaveValue("");
    await page
      .locator(".draft-item")
      .filter({ hasText: "Fix the failing tests" })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Message Anvil" }),
    ).toHaveValue("Fix the failing tests without changing the public API.");
    await page.reload();
    await expect(
      page.locator(".draft-item").filter({ hasText: "Fix the failing tests" }),
    ).toBeVisible();
    await page
      .locator(".draft-item")
      .filter({ hasText: "Fix the failing tests" })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Message Anvil" }),
    ).toHaveValue("Fix the failing tests without changing the public API.");
    expect(errors).toEqual([]);
  } catch (error) {
    console.error(await page?.locator("body").innerText());
    console.error(
      "PTY input",
      JSON.stringify(
        await app.evaluate(
          () =>
            (globalThis as unknown as { anvilTestInput: string[] })
              .anvilTestInput,
        ),
      ),
    );
    console.error("PTY output", JSON.stringify(terminalOutput.join("")));
    console.error("Proof bytes", await readFile(path.join(root, "terminal-proof.txt")).catch(String));
    throw error;
  } finally {
    await app
      .evaluate(({ dialog, BrowserWindow }) => {
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
      })
      .catch(() => {});
    await app.close();
    await rm(root, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
