import { test, expect } from '@playwright/test';

test.describe('Aavritti Internet Radio E2E Dashboard', () => {
  test('logs in, controls playback, checks stream, and inspects device', async ({ page }) => {
    // 1. Visit root, verify redirect to /login
    await page.goto('/');
    await expect(page).toHaveURL(/.*login/);

    // 2. Perform Owner Password Login
    await expect(page.getByRole('heading', { name: 'Aavritti' })).toBeVisible();
    await page.fill('input[id="password"]', 'admin123');
    await page.click('button[type="submit"]');

    // 3. Verify redirected to Dashboard
    await expect(page.getByText('Ring Buffer')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Volume')).toBeVisible();

    // Test volume preset 50%
    const vol50Btn = page.getByRole('button', { name: '50%' });
    if (await vol50Btn.isVisible()) {
      await vol50Btn.click();
    }

    // 5. Switch to Stations Tab
    const stationsTabBtn = page.getByRole('button', { name: /Stations/i }).first();
    await stationsTabBtn.click();
    await expect(page.getByPlaceholder('Search stations by name...')).toBeVisible();

    // 6. Switch to Add Stream Tab
    const addStreamTabBtn = page.getByRole('button', { name: /Add Stream/i }).first();
    await addStreamTabBtn.click();
    await expect(page.getByText('SSRF-Safe Stream Inspector')).toBeVisible();

    // Fill valid stream URL and check
    const streamInput = page.getByPlaceholder('https://example.com/stream.mp3');
    await streamInput.fill('http://stream.zeno.fm/f1q8q86n02quv');
    await page.getByRole('button', { name: /Check Stream/i }).click();

    // 7. Switch to Device Diagnostics Tab
    const deviceTabBtn = page.getByRole('button', { name: /Device/i }).first();
    await deviceTabBtn.click();
    await expect(page.getByText('ESP32-WROOM-32')).toBeVisible();
    await expect(page.getByText('SRAM Heap Budget & Margin')).toBeVisible();
    await expect(page.getByText('Wi-Fi Signal')).toBeVisible();
    await expect(page.getByText('Throughput')).toBeVisible();
  });
});
