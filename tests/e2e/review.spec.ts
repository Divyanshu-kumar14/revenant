import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { SESSION_COOKIE, createSession } from "@/auth/session";

// Serial: /api/admin/extract claims whatever is queued, so two tests extracting at once could
// take each other's item.
test.describe.configure({ mode: "serial" });

const FIXTURE_TITLE = "Fixture: mill pond at first light";

function channel(): number {
  return Math.floor(Math.random() * 256);
}

async function signIn(page: Page, baseURL: string | undefined): Promise<void> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !baseURL) throw new Error("playwright.config.ts must set SESSION_SECRET and baseURL.");
  await page.context().addCookies([{ name: SESSION_COOKIE, value: createSession("e2e", secret), url: baseURL }]);
}

/** Upload one photograph, extract it with the fixture extractor, and open its review page. */
async function openFreshReview(page: Page): Promise<string> {
  const buffer = await sharp({
    create: { width: 320, height: 240, channels: 3, background: { r: channel(), g: channel(), b: channel() } },
  })
    .jpeg()
    .toBuffer();
  const ingest = await page.request.post("/api/admin/ingest", {
    multipart: { file: { name: "review.jpg", mimeType: "image/jpeg", buffer } },
  });
  expect(ingest.status()).toBe(200);
  const { itemId } = (await ingest.json()) as { itemId: string };

  const extract = await page.request.post("/api/admin/extract", { data: { limit: 5 } });
  expect(extract.status()).toBe(200);
  const counts = (await extract.json()) as { extracted: number };
  expect(counts.extracted).toBeGreaterThanOrEqual(1);

  await page.goto(`/admin/review/${itemId}`);
  await expect(page.getByRole("heading", { name: /Fixture: mill pond/ })).toBeVisible();
  return itemId;
}

test("accepting a proposed record publishes it and survives a reload", async ({ page, baseURL }) => {
  await signIn(page, baseURL);
  await openFreshReview(page);

  await expect(page.getByLabel("Title")).toHaveValue(FIXTURE_TITLE);
  await expect(page.getByLabel("People named in the caption or text")).toHaveValue(/Ada Fixture/);
  await expect(page.getByText("model confidence 0.31 · low")).toBeVisible();

  const image = page.getByRole("img", { name: FIXTURE_TITLE });
  await expect(image).toBeVisible();
  expect(await image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Published" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Published" })).toBeVisible();
});

test("a blank title is refused with a plain message", async ({ page, baseURL }) => {
  await signIn(page, baseURL);
  await openFreshReview(page);

  await page.getByLabel("Title").fill("");
  await page.getByRole("button", { name: "Accept" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "Enter a title before publishing." })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Needs review" })).toBeVisible();
});
