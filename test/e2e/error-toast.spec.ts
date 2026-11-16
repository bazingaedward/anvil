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
test("error toast is visible without moving the composer or taking focus", async ({
  page,
}) => {
  await page.goto(url + "test/e2e/fixtures/error-toast.html");
  await page.waitForFunction(
    () => typeof (window as any).showTestToast === "function",
  );
  const composer = page.getByRole("textbox", { name: "草稿" });
  await composer.focus();
  const before = await composer.boundingBox();
  await page.evaluate(() => (window as any).showTestToast());
  const toast = page.getByRole("alert");
  await expect(toast).toContainText("操作失败");
  await expect(toast).toContainText("模型连接失败，请重试。");
  await expect(toast).not.toContainText("remote method");
  await expect(toast).toHaveCSS("position", "fixed");
  await expect(composer).toBeFocused();
  expect(await composer.boundingBox()).toEqual(before);
  await expect(composer).toHaveValue("未发送的内容");
  await page.getByRole("button", { name: "关闭错误提示" }).click();
  await expect(toast).toHaveCount(0);
  await page.evaluate(() => (window as any).showTestToast());
  await expect(toast).toBeVisible();
});
