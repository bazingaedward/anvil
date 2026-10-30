import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { git } from "../../desktop/main/workspace";

test("real agent streams, requests permission, resumes context, cancels and restores history", async () => {
  test.skip(
    !process.env.ANVIL_REAL_AGENT,
    "Opt in through keygrant with ANVIL_REAL_AGENT=1.",
  );
  test.setTimeout(120000);
  const root = await mkdtemp(path.join(os.tmpdir(), "anvil-agent-ui-"));
  const profile = await mkdtemp(path.join(os.tmpdir(), "anvil-agent-profile-"));
  await git(root, ["init", "-b", "main"]);
  await writeFile(path.join(root, "proof.txt"), "ANVIL_DESKTOP_TOOL_OK");
  await writeFile(
    path.join(profile, "workspace.json"),
    JSON.stringify({ root }),
  );
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (pair): pair is [string, string] => pair[1] !== undefined,
      ),
    ),
    ANVIL_TEST_USER_DATA: profile,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = () =>
    electron.launch({
      ...(process.env.ANVIL_ELECTRON_PATH
        ? { executablePath: process.env.ANVIL_ELECTRON_PATH, args: [] }
        : { args: ["."] }),
      env,
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const input = page.getByRole("textbox", { name: "Message Anvil" });
    await input.fill(
      "Remember ANVIL_CONTEXT_OK. Reply exactly ANVIL_DESKTOP_OK. Do not use any tools.",
    );
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.locator(".agent-response")).toContainText(
      "ANVIL_DESKTOP_OK",
      { timeout: 45000 },
    );
    await expect(page.locator(".agent-task [role=status]")).toHaveText(
      "completed",
    );
    await input.fill(
      "Use the read tool to read proof.txt and report its contents and the marker I asked you to remember.",
    );
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(
      page.getByRole("region", { name: "Tool approval" }),
    ).toContainText("proof.txt", { timeout: 45000 });
    await page.getByRole("button", { name: "Allow once" }).click();
    await expect(page.locator(".agent-response").last()).toContainText(
      "ANVIL_DESKTOP_TOOL_OK",
      { timeout: 45000 },
    );
    await expect(page.locator(".agent-response").last()).toContainText(
      "ANVIL_CONTEXT_OK",
    );
    await expect(page.locator(".agent-task [role=status]").last()).toHaveText(
      "completed",
    );
    await page.getByRole("button", { name: "New conversation" }).click();
    await input.fill("Read proof.txt using the read tool.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(
      page.getByRole("region", { name: "Tool approval" }),
    ).toBeVisible({ timeout: 45000 });
    await page.getByRole("button", { name: "Cancel task" }).click();
    await expect(page.locator(".agent-task [role=status]")).toHaveText(
      "cancelled",
      { timeout: 10000 },
    );
    await expect(
      page.getByRole("region", { name: "Tool approval" }),
    ).toHaveCount(0);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator(".agent-task [role=status]")).toHaveText(
      "cancelled",
    );
    await page
      .locator(".draft-item")
      .filter({ hasText: "Remember ANVIL_CONTEXT_OK" })
      .click();
    await expect(page.locator(".agent-response").last()).toContainText(
      "ANVIL_DESKTOP_TOOL_OK",
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
