import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
test.use({ channel: process.env.ANVIL_BROWSER_CHANNEL });
let server: ViteDevServer;
let url: string;
test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    plugins: [react()],
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  url = server.resolvedUrls!.local[0];
});
test.afterAll(async () => {
  await server?.close();
});
test("compact composer expands for references, clears sent chips, and supports steering and queueing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(url + "test/e2e/fixtures/conversation.html");
  const composer = page.locator(".composer");
  const input = page.getByRole("textbox", { name: "向 Anvil 发送消息" });
  await expect(composer).toHaveClass(/is-compact/);
  const compact = (await composer.boundingBox())!.height;
  expect(compact).toBeLessThan(85);
  await input.fill("第一行");
  await input.press("Shift+Enter");
  await expect(composer).toHaveClass(/is-expanded/);
  expect((await composer.boundingBox())!.height).toBeGreaterThan(compact);
  await input.fill("");
  await expect(composer).toHaveClass(/is-compact/);
  await page.getByLabel("添加上下文", { exact: true }).click();
  await page.getByRole("button", { name: "添加本地文件夹…" }).click();
  await expect(composer.locator(".attachment-chip")).toContainText(
    "echo-english",
  );
  await expect(composer).toHaveClass(/is-expanded/);
  await input.fill("开始");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(composer.locator(".attachment-chip")).toHaveCount(0);
  await expect(page.locator(".agent-prompt")).not.toContainText("echo-english");
  await expect(page.locator(".conversation-folders summary")).toContainText(
    "echo-english",
  );
  await expect(composer).toHaveClass(/is-compact/);
  await input.fill("改成中文");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(
    page.getByText("Steering · 已接收", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "停止任务", exact: true }),
  ).toBeVisible();
  await input.fill("之后运行测试");
  await page
    .getByRole("button", { name: "Queueing（排队）", exact: true })
    .click();
  await expect(
    page.getByText("Queueing · 等待当前任务结束", { exact: true }),
  ).toBeVisible();
  const calls = await page.evaluate(() => (window as any).calls);
  expect(calls.map((c: any) => c.type)).toEqual(["start", "steer", "start"]);
  expect(calls[2].options.delivery).toBe("queue");
  await input.fill("保留这条");
  await page.evaluate(() => ((window as any).failSteer = true));
  await input.press("Enter");
  await expect(page.getByRole("alert")).toContainText("转向被拒绝");
  await expect(input).toHaveValue("保留这条");
});

test("IME Enter does not send and existing sent directories stay out of the composer", async ({
  page,
}) => {
  await page.goto(url + "test/e2e/fixtures/conversation.html");
  const input = page.getByRole("textbox", { name: "向 Anvil 发送消息" });
  await input.fill("中文输入法");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    isComposing: true,
    keyCode: 229,
  });
  expect(await page.evaluate(() => (window as any).calls.length)).toBe(0);
  await input.press("Enter");
  await expect(input).toHaveValue("");
});

test("sent images appear above text and open an accessible preview, including steering", async ({
  page,
}) => {
  await page.goto(url + "test/e2e/fixtures/conversation.html");
  const input = page.getByRole("textbox", { name: "向 Anvil 发送消息" });
  async function attachImage() {
    await page.locator(".composer").evaluate((el) => {
      const data = new DataTransfer();
      data.items.add(
        new File(["fixture"], "screen.png", { type: "image/png" }),
      );
      el.dispatchEvent(
        new DragEvent("drop", {
          dataTransfer: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect(page.locator(".composer-attachments")).toContainText(
      "screen.png",
    );
  }
  await attachImage();
  await input.fill("检查图片");
  await input.press("Enter");
  const message = page.locator(".agent-prompt").first();
  await expect(message.locator(".message-image img")).toBeVisible();
  expect(await message.evaluate((el) => el.firstElementChild?.className)).toBe(
    "message-images",
  );
  await message.getByRole("button", { name: "预览图片：screen.png" }).click();
  const preview = page.getByRole("dialog", { name: "screen.png" });
  await expect(preview.getByRole("img")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await attachImage();
  await input.fill("再看这张");
  await input.press("Enter");
  await expect(
    page.locator(".steering-message .message-image img"),
  ).toBeVisible();
  await page.locator(".steering-message .message-image").click();
  await preview.getByRole("button", { name: "关闭图片预览" }).click();
  await expect(preview).toHaveCount(0);
});

test("a repository-bound review skill can be selected from chat after enabling the plugin", async ({
  page,
}) => {
  await page.goto(url + "test/e2e/fixtures/conversation.html");
  await page.getByLabel("添加上下文", { exact: true }).click();
  await page.getByRole("button", { name: "添加本地文件夹…" }).click();
  await page.getByRole("button", { name: "扩展", exact: true }).first().click();
  await page.getByRole("button", { name: "启用整套扩展" }).click();
  await page.getByRole("button", { name: "GitHub · MCP →" }).click();
  await page.getByLabel("GitHub 登录名").fill("alice");
  await page.getByRole("button", { name: "保存绑定" }).click();
  await expect(page.getByText("本机账号已匹配")).toBeVisible();
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  const input = page.getByRole("textbox", { name: "向 Anvil 发送消息" });
  await input.fill("/rev");
  await page.getByRole("button", { name: "/review-pr", exact: true }).click();
  await expect(input).toHaveValue("/review-pr ");
});
