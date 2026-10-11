import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Fresh database per run so tests never touch real or demo data.
const dir = mkdtempSync(join(tmpdir(), "pt-e2e-"));
const py = process.platform === "win32" ? "..\\.venv\\Scripts\\python.exe" : "../.venv/bin/python";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:8123",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: "iphone-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: `${py} -m uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port 8123`,
    url: "http://127.0.0.1:8123/api/health",
    reuseExistingServer: false,
    env: { PT_DATA_DIR: dir, PT_DB_PATH: join(dir, "e2e.db"), PT_SCHEDULER: "0", PT_DEMO: "0", GEMINI_API_KEY: "", GROQ_API_KEY: "", LLM_BASE_URL: "" },
  },
});
