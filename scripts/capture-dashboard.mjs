import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const URL = process.env.DASHBOARD_URL || "http://127.0.0.1:5050";
const OUT = path.join(__dirname, "..", "dashboard-screenshot.png");

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

try {
  await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector("#comparison-body tr:not(:has(.loading))", {
    timeout: 30000,
  });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: OUT, fullPage: true });

  const title = await page.title();
  const badge = await page.locator("#refresh-status").textContent();
  const tableText = await page.locator("#comparison-body").innerText();

  console.log(
    JSON.stringify(
      {
        ok: true,
        url: URL,
        title,
        status: badge?.trim(),
        screenshot: OUT,
        tablePreview: tableText.split("\n").slice(0, 4),
      },
      null,
      2
    )
  );
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
