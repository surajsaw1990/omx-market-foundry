import { expect, test, type Page } from "@playwright/test";

/**
 * Full reviewer journey in a real browser:
 * login → run discovery (streamed) → queue → candidate → edit → approve → create market →
 * market page with provenance; plus reject, blocked duplicate, and auth guard.
 */

async function login(page: Page, name = "E2E Reviewer") {
  await page.goto("/login");
  await page.fill("#name", name);
  await page.fill("#code", "e2e-code");
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

test.describe.configure({ mode: "serial" });

test("redirects anonymous users to login and rejects a wrong code", async ({ page }) => {
  await page.goto("/candidates");
  await expect(page).toHaveURL(/\/login\?next=%2Fcandidates/);
  await page.fill("#name", "Mallory");
  await page.fill("#code", "wrong");
  await page.click("button[type=submit]");
  await expect(page.getByText("That access code is not valid.")).toBeVisible();
});

test("full workflow: discover → review → edit → approve → create market", async ({ page, request }) => {
  await login(page);

  // Only the deterministic fixture feed for this test run.
  const sources = (await (await page.request.get("/api/sources")).json()).sources as { id: string; type: string; enabled: boolean }[];
  for (const s of sources) {
    const enabled = s.type === "fixture";
    if (s.enabled !== enabled) await page.request.patch(`/api/sources/${s.id}`, { data: { enabled } });
  }

  // Discover (streamed log)
  await page.getByTestId("run-discovery").click();
  const log = page.getByTestId("discovery-log");
  await expect(log).toContainText("Demo Wire", { timeout: 30_000 });
  await expect(log).toContainText("Evidence added to", { timeout: 30_000 });
  await expect(page.getByText("Open review queue")).toBeVisible({ timeout: 30_000 });

  // Queue
  await page.getByText("Open review queue").click();
  await expect(page).toHaveURL(/\/candidates/);
  const list = page.getByTestId("candidate-list");
  await expect(list.locator("li")).not.toHaveCount(0);

  // Duplicate of a live market cannot be approved
  await list.getByText(/Will Bitcoin close above/).click();
  await expect(page.locator('[data-code="DUPLICATE_MARKET"]')).toBeVisible();
  await expect(page.getByTestId("approve-btn")).toBeDisabled();
  await page.goBack();

  // Conflicting sources are surfaced on the merged Starship candidate
  await list.getByText(/Starship/).click();
  await expect(page.locator('[data-code="CONFLICTING_SOURCES"]')).toBeVisible();
  await expect(page.getByTestId("source-card")).toHaveCount(2);
  await page.goBack();

  // Open the EU vote candidate, edit it with live validation
  await list.getByText(/European Parliament/).click();
  await expect(page.getByTestId("candidate-question")).toContainText("European Parliament");
  await page.getByTestId("edit-btn").click();
  const q = page.locator("#q");
  await q.fill("Will the European Parliament significantly back the AI Liability Directive?");
  await expect(page.locator('[data-code="AMBIGUOUS_WORDING"]')).toBeVisible(); // live preview
  await expect(page.locator('[data-code="NO_DEADLINE_IN_QUESTION"]')).toBeVisible();
  await q.fill("Will the European Parliament adopt the AI Liability Directive in its plenary vote on October 19, 2026?");
  await expect(page.locator('[data-code="AMBIGUOUS_WORDING"]')).toHaveCount(0);
  await page.getByTestId("save-btn").click();
  await expect(page.getByText("Changes saved and re-validated.")).toBeVisible();
  await expect(page.getByTestId("candidate-question")).toContainText("adopt the AI Liability Directive");

  // Approve (warnings must be acknowledged)
  await page.getByTestId("approve-btn").click();
  const confirm = page.getByTestId("confirm-approve");
  await expect(confirm).toBeDisabled();
  await page.getByTestId("ack-warnings").check();
  await confirm.click();
  await expect(page.getByText("Candidate approved.")).toBeVisible();
  await expect(page.getByText(/Approved by/)).toContainText("E2E Reviewer");

  // Create market
  await page.getByTestId("create-market-btn").click();
  await expect(page.getByText("Market created on OmniMarketX (mock API).")).toBeVisible();
  await page.getByRole("button", { name: "View market" }).click();
  await expect(page.getByTestId("market-title")).toContainText("adopt the AI Liability Directive");
  await expect(page.getByTestId("provenance-source")).toHaveCount(1);
  await expect(page.getByTestId("market-payload")).toContainText('"approvedBy": "E2E Reviewer"');

  // Market listed
  await page.goto("/markets");
  await expect(page.getByTestId("market-list")).toContainText("AI Liability Directive");

  // Unauthenticated API access is refused
  const anon = await request.get("/api/candidates", { headers: { cookie: "" } });
  expect(anon.status()).toBe(401);
});

test("reject a candidate with a reason", async ({ page }) => {
  await login(page);
  await page.goto("/candidates");
  await page.getByTestId("candidate-list").getByText(/Nimbus Robotics/).click();
  await page.getByTestId("reject-btn").click();
  await expect(page.getByTestId("confirm-reject")).toBeDisabled();
  await page.getByText("Low trader interest").click();
  await page.getByTestId("confirm-reject").click();
  await expect(page.getByText("Candidate rejected.")).toBeVisible();
  await expect(page.getByText(/Rejected by/)).toContainText("Low trader interest");
});

test("discovery page shows the signal inspector with skip reasons", async ({ page }) => {
  await login(page);
  await page.goto("/discovery");
  await expect(page.getByText("Signal inspector")).toBeVisible();
  await expect(page.getByTestId("signal-row").first()).toBeVisible();
  await page.getByRole("button", { name: /^Filtered/ }).click();
  await expect(page.getByTestId("signal-row").first()).toContainText("Low market signal");
});
