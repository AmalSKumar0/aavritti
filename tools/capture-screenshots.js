const { chromium } = require('@playwright/test');
const path = require('path');

const ARTIFACT_DIR = '/home/amalskumar/.gemini/antigravity-cli/brain/85f402ce-8a57-4878-81e5-0a8043bb094d/screenshots';

async function capture() {
  const browser = await chromium.launch();

  // Desktop captures
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    // 1. Login page
    await page.goto('http://localhost:3000/login');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-login-desktop.png') });

    // Login
    await page.fill('input[id="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForSelector('text=Ring Buffer', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // 2. Now Playing Tab
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-now-playing-desktop.png') });

    // 3. Stations Tab
    await page.click('button:has-text("Stations")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-stations-desktop.png') });

    // 4. Add Stream Tab
    await page.click('button:has-text("Add Stream")');
    await page.waitForTimeout(500);
    const streamInput = page.locator('input[id="stream-url"]');
    await streamInput.fill('http://stream.zeno.fm/f1q8q86n02quv');
    await page.click('button:has-text("Check Stream")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '04-add-stream-desktop.png') });

    // 5. Device Tab
    await page.click('button:has-text("Device")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '05-device-desktop.png') });

    await page.close();
  }

  // Mobile captures (iPhone / Pixel portrait 375x812)
  {
    const page = await browser.newPage({
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
    });

    // 1. Login page mobile
    await page.goto('http://localhost:3000/login');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-login-mobile.png') });

    // Login
    await page.fill('input[id="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForSelector('text=Ring Buffer', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // 2. Now Playing Tab mobile
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-now-playing-mobile.png') });

    // 3. Stations Tab mobile
    const stationsBtn = page.locator('nav[aria-label="Mobile navigation"] button:has-text("Stations")');
    await stationsBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-stations-mobile.png') });

    // 4. Add Stream Tab mobile
    const addStreamBtn = page.locator('nav[aria-label="Mobile navigation"] button:has-text("Add Stream")');
    await addStreamBtn.click();
    await page.waitForTimeout(500);
    const streamInput = page.locator('input[id="stream-url"]');
    await streamInput.fill('http://stream.zeno.fm/f1q8q86n02quv');
    await page.click('button:has-text("Check Stream")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '04-add-stream-mobile.png') });

    // 5. Device Tab mobile
    const deviceBtn = page.locator('nav[aria-label="Mobile navigation"] button:has-text("Device")');
    await deviceBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '05-device-mobile.png') });

    await page.close();
  }

  await browser.close();
  console.log('Screenshots captured successfully into:', ARTIFACT_DIR);
}

capture().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
