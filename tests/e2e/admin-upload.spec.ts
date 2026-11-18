import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { SESSION_COOKIE, createSession } from "@/auth/session";

/** A small solid-colour JPEG. Different sizes and colours give different bytes, so no duplicate. */
function jpeg(width: number, height: number, background: { r: number; g: number; b: number }) {
  return sharp({ create: { width, height, channels: 3, background } }).jpeg().toBuffer();
}

/** A colour channel that differs between runs, so a reused server never sees these bytes twice. */
function channel(): number {
  return Math.floor(Math.random() * 256);
}

test("an admin uploads two photographs and sees both queued", async ({
  page,
  context,
  baseURL,
}) => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !baseURL) throw new Error("playwright.config.ts must set SESSION_SECRET and baseURL.");
  await context.addCookies([
    { name: SESSION_COOKIE, value: createSession("e2e", secret), url: baseURL },
  ]);

  const [first, second] = await Promise.all([
    jpeg(320, 240, { r: 140, g: channel(), b: 40 }),
    jpeg(200, 300, { r: 30, g: channel(), b: 160 }),
  ]);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Upload photographs" })).toBeVisible();

  await page.getByLabel("Choose files").setInputFiles([
    { name: "front.jpg", mimeType: "image/jpeg", buffer: first },
    { name: "back.jpg", mimeType: "image/jpeg", buffer: second },
  ]);

  const results = page.locator('[aria-live="polite"]');
  const rows = results.getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "front.jpg" })).toContainText("Queued for extraction");
  await expect(rows.filter({ hasText: "back.jpg" })).toContainText("Queued for extraction");

  const audit = await new AxeBuilder({ page }).analyze();
  const serious = audit.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(serious).toEqual([]);
});
