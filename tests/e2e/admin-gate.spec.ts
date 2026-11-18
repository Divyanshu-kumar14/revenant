import { expect, test } from "@playwright/test";
import { SESSION_COOKIE, SESSION_TTL_MS, createSession } from "@/auth/session";

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("playwright.config.ts must set SESSION_SECRET.");
  return value;
}

function baseUrl(baseURL: string | undefined): string {
  if (!baseURL) throw new Error("playwright.config.ts must set baseURL.");
  return baseURL;
}

/** Flip the last two characters of the signature so the HMAC no longer matches. */
function tamper(token: string): string {
  const head = token.slice(0, -2);
  const tail = token.slice(-2);
  const flip = (c: string) => (c === "A" ? "B" : "A");
  return head + [...tail].map(flip).join("");
}

// First: if the login page is not reachable without a session, the gate is in the wrong place.
test("without a cookie the login page renders", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("without a cookie /admin redirects to the login page", async ({ request }) => {
  const response = await request.get("/admin", { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers()["location"]).toMatch(/\/admin\/login$/);
});

test("a valid cookie opens /admin", async ({ page, context, baseURL }) => {
  await context.addCookies([
    { name: SESSION_COOKIE, value: createSession("e2e", secret()), url: baseUrl(baseURL) },
  ]);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Upload photographs" })).toBeVisible();
});

test("a tampered cookie lands on the login page", async ({ page, context, baseURL }) => {
  await context.addCookies([
    { name: SESSION_COOKIE, value: tamper(createSession("e2e", secret())), url: baseUrl(baseURL) },
  ]);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("an expired cookie lands on the login page", async ({ page, context, baseURL }) => {
  const expired = createSession("e2e", secret(), Date.now() - SESSION_TTL_MS - 1_000);
  await context.addCookies([{ name: SESSION_COOKIE, value: expired, url: baseUrl(baseURL) }]);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
