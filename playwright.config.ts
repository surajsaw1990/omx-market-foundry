import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

/**
 * Browser e2e tests run against a production build (`next start`) with a throwaway PGlite
 * database, the rule-based analyzer and only the bundled fixture feed enabled by the test itself,
 * so results are deterministic and need no network or API keys.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PGLITE_DATA_DIR: ".e2e-data/pglite",
      LLM_PROVIDER: "heuristic",
      DISCOVERY_COOLDOWN_SECONDS: "0",
      REVIEWER_ACCESS_CODE: "e2e-code",
      SESSION_SECRET: "e2e-session-secret-0123456789",
    },
  },
});
