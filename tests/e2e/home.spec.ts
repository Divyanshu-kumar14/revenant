import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the landing page states what the product is and what it is not", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Every photograph deserves a name." }),
  ).toBeVisible();
  await expect(page.getByText("Build in progress").first()).toBeVisible();
  await expect(page.getByText("The archive is not live yet.")).toBeVisible();
});

test("the landing page has no serious accessibility violations", async ({
  page,
}) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();

  const serious = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(serious).toEqual([]);
});
