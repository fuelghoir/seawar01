import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const projectRoot = path.resolve(import.meta.dirname, "..");
const outputRoot = path.join(projectRoot, "deliverables", "screenshots");
const chromeExecutable = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const baseUrl = process.env.CAPTURE_BASE_URL || "http://localhost:3000";

fs.mkdirSync(outputRoot, { recursive: true });

async function settle(page, waitMs = 5000) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(waitMs);
}

async function prepare(page) {
  await page.addInitScript(() => {
    localStorage.setItem("sw_effects", "reduced");
    localStorage.setItem("sw_lang", "en");
  });
}

async function captureMobile(browser) {
  const context = await browser.newContext({
    viewport: { width: 428, height: 926 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  });
  const page = await context.newPage();
  await prepare(page);

  await page.goto(`${baseUrl}/`);
  await settle(page, 6500);
  await page.screenshot({
    path: path.join(outputRoot, "01-app-home-current.png"),
    animations: "disabled",
  });

  const playButton = page.getByRole("button", { name: /play now/i }).first();
  if (await playButton.isVisible().catch(() => false)) {
    await playButton.click();
    await page.waitForTimeout(700);
    await page.screenshot({
      path: path.join(outputRoot, "02-app-game-modes-current.png"),
      animations: "disabled",
    });
  }

  await page.goto(`${baseUrl}/shop`);
  await settle(page, 3500);
  await page.screenshot({
    path: path.join(outputRoot, "03-app-shop-current.png"),
    animations: "disabled",
  });

  await page.goto(`${baseUrl}/leaderboard`);
  await settle(page, 3500);
  await page.screenshot({
    path: path.join(outputRoot, "04-app-leaderboard-current.png"),
    animations: "disabled",
  });

  await page.goto(`${baseUrl}/stats`);
  await settle(page, 1200);
  await page.screenshot({
    path: path.join(outputRoot, "05-stats-mobile.png"),
    animations: "disabled",
  });

  await context.close();
}

async function captureDesktop(browser) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await prepare(page);

  await page.goto(`${baseUrl}/stats`);
  await settle(page, 1200);
  await page.screenshot({
    path: path.join(outputRoot, "06-stats-video-hero-1920x1080.png"),
    animations: "disabled",
  });
  await page.screenshot({
    path: path.join(outputRoot, "07-stats-full-page.png"),
    animations: "disabled",
    fullPage: true,
  });

  await page.goto(`${baseUrl}/`);
  await settle(page, 6500);
  await page.screenshot({
    path: path.join(outputRoot, "08-app-desktop-current-1920x1080.png"),
    animations: "disabled",
  });

  await context.close();
}

const browser = await chromium.launch({
  executablePath: chromeExecutable,
  headless: true,
  args: ["--disable-gpu", "--no-first-run", "--disable-background-networking"],
});

try {
  await captureMobile(browser);
  await captureDesktop(browser);
} finally {
  await browser.close();
}

console.log(`Screenshots saved to ${outputRoot}`);
