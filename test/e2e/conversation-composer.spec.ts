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
  await page.getByRole("button", { name: "添加文件夹（可选）" }).click();
  await expect(composer.locator(".attachment-chip")).toContainText(
    "echo-english",
  );
  await expect(composer).toHaveClass(/is-expanded/);
  await input.fill("开始");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(composer.locator(".attachment-chip")).toHaveCount(0);
  await expect(page.locator(".agent-prompt")).toContainText("echo-english");
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
