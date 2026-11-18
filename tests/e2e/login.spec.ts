import { expect, test, type Page } from "@playwright/test";
import { SESSION_COOKIE } from "@/auth/session";

// Not tested here: the five-failure limit (the dev server's limiter is shared across workers
// and retries; tests/unit/login-route.test.ts proves it). The /admin gate is in admin-gate.spec.ts.

function adminPassword(): string {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("playwright.config.ts must set ADMIN_PASSWORD.");
  return password;
}

async function signIn(page: Page, password: string): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("the login page shows a labelled password field", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveAttribute("type", "password");
});

test("a wrong password shows the alert and stays on the login page", async ({ page, context }) => {
  await signIn(page, "not-the-e2e-password");
  await expect(page).toHaveURL(/\/admin\/login\?error=wrong$/);
  await expect(
    page.getByRole("alert").filter({ hasText: "That password was not accepted." }),
  ).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.find((cookie) => cookie.name === SESSION_COOKIE)).toBeUndefined();
});

test("the right password lands on /admin with an httpOnly SameSite=Lax session cookie", async ({
  page,
  context,
}) => {
  await signIn(page, adminPassword());
  await expect(page).toHaveURL(/\/admin$/);
  const session = (await context.cookies()).find((cookie) => cookie.name === SESSION_COOKIE);
  expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
});

test("signing out removes the session cookie", async ({ page, context }) => {
  await signIn(page, adminPassword());
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  const cookies = await context.cookies();
  expect(cookies.find((cookie) => cookie.name === SESSION_COOKIE)).toBeUndefined();
});
