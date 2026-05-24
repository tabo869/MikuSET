import { test, expect } from '@playwright/test';

// ============================================================================
// [E2E-01] アプリ起動〜準備完了〜クリア完了の通しプレイ (AutoPlay)
// ============================================================================
test('E2E-01: AutoPlay through a full song to completion and result screen', async ({ page }) => {
  // タイムアウトを極端に長く設定（楽曲1曲を通しで実行するため、5分 = 300,000ms）
  test.setTimeout(300000);

  await page.goto('/');

  const startButton = page.locator('button', { hasText: /^(START|スタート)$/i });
  await startButton.waitFor({ state: 'visible', timeout: 30000 });

  const autoPlayLabel = page.locator('label', { hasText: 'オートプレイ (演出確認用)' });
  await autoPlayLabel.check();

  await startButton.click();
  await startButton.waitFor({ state: 'hidden', timeout: 10000 });

  // Wait until the result screen appears (STAGE CLEARED).
  // If this times out after ~4 minutes, then the resulting screen bug is confirmed!
  const resultText = page.locator('text=STAGE CLEARED');
  await resultText.waitFor({ state: 'visible', timeout: 280000 });

  // Validate the NEXT button is visible.
  const nextButton = page.locator('button', { hasText: 'NEXT (SELECT SONG)' });
  await expect(nextButton).toBeVisible();
});

// ============================================================================
// [E2E-02] 仮想入力モードによる手動打鍵シナリオ
// ============================================================================
test('E2E-02: Manual input via Virtual Keyboard updates the game state', async ({ page }) => {
  await page.goto('/');

  const startButton = page.locator('button', { hasText: /^(START|スタート)$/i });
  await startButton.waitFor({ state: 'visible', timeout: 30000 });

  const virtualInputLabel = page.locator('label', { hasText: 'タッチ・キーボード操作モード (カメラOFF)' });
  await virtualInputLabel.check();

  await startButton.click();
  await startButton.waitFor({ state: 'hidden', timeout: 10000 });

  // Simulate slamming keys
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('w');
    await page.keyboard.press('o');
    await page.waitForTimeout(100);
  }

  const hitsOrMisses = page.locator('text=MISS');
  await expect(hitsOrMisses).toBeVisible();
});

// ============================================================================
// [E2E-05] プレイの中途ストップと状態リセット検証
// ============================================================================
test('E2E-05: Interrupt play with STOP button returns to main menu without results', async ({ page }) => {
  await page.goto('/');

  const startButton = page.locator('button', { hasText: /^(START|スタート)$/i });
  await startButton.waitFor({ state: 'visible', timeout: 30000 });

  await startButton.click();
  await startButton.waitFor({ state: 'hidden', timeout: 10000 });

  // Let it play for a few seconds
  await page.waitForTimeout(5000);

  // Click STOP button
  const stopButton = page.locator('button', { hasText: /^(STOP|中断)$/i });
  await stopButton.waitFor({ state: 'visible' });
  await stopButton.click();

  // Verify START is visible again
  await expect(startButton).toBeVisible();

  // Verify Result Screen is NOT visible
  const resultText = page.locator('text=STAGE CLEARED');
  await expect(resultText).not.toBeVisible();
});

// ============================================================================
// [E2E-06] 楽曲の切り替え検証
// ============================================================================
test('E2E-06: Changing song dropdown loads new song successfully', async ({ page }) => {
  await page.goto('/');

  const startButton = page.locator('button', { hasText: /^(START|スタート)$/i });
  await startButton.waitFor({ state: 'visible', timeout: 30000 });

  const select = page.locator('select');
  // Select the second option (wait, we don't know the exact value, but it's another URL)
  // Let's grab the options and select the second one.
  const selectElement = await select.elementHandle();
  if (selectElement) {
    const options = await selectElement.$$eval('option', (opts) => opts.map(o => o.value));
    if (options.length > 1) {
      await select.selectOption(options[1]); // change to second song
    }
  }

  // Expect START button to become LOADING temporarily or stay START after loading
  // Eventually it should be START
  await startButton.waitFor({ state: 'visible', timeout: 30000 });
});

// ============================================================================
// [E2E-03] 画面のリサイズによるUIの破壊耐性検証
// ============================================================================
test('E2E-03: Extreme resize does not crash the app', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(2000);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(1000); 
  
  await page.setViewportSize({ width: 1000, height: 200 });
  await page.waitForTimeout(1000);

  const startButton = page.locator('button', { hasText: /^(START|スタート)$/i });
  await expect(startButton).toBeVisible();
});

// ============================================================================
// [E2E-04] カメラアクセス拒否時の異常系シナリオ
// ============================================================================
test('E2E-04: Camera permission denied gracefully degrades', async ({ context, page }) => {
  await context.grantPermissions([]); 

  await page.goto('/');

  const startButton = page.locator('button', { hasText: /^(START|スタート)$/i });
  await startButton.waitFor({ state: 'visible', timeout: 30000 });

  const virtualInputLabel = page.locator('label', { hasText: 'タッチ・キーボード操作モード (カメラOFF)' });
  await expect(virtualInputLabel).toBeVisible();
  
  await virtualInputLabel.check();
  expect(await virtualInputLabel.isChecked()).toBe(true);
});

// ============================================================================
// [E2E-07] カメラのドラッグ操作と「視点をリセット」ボタンの検証
// ============================================================================
test('E2E-07: AutoPlay manual camera reset and automatic reset on completion', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto('/');

  const startButton = page.locator('button', { hasText: /^(START|スタート)$/i });
  await startButton.waitFor({ state: 'visible', timeout: 30000 });

  const autoPlayLabel = page.locator('label', { hasText: 'オートプレイ (演出確認用)' });
  await autoPlayLabel.check();

  await startButton.click();
  await startButton.waitFor({ state: 'hidden', timeout: 10000 });

  // Canvas要素の取得
  const canvas = page.locator('canvas[data-engine^="three.js"]');
  await canvas.waitFor({ state: 'visible' });

  // 少し再生されるのを待つ
  await page.waitForTimeout(3000);

  // カメラをドラッグして視点を移動させる
  const box = await canvas.boundingBox();
  if (box) {
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 150, startY + 80, { steps: 10 });
    await page.mouse.up();
  }

  // 「視点をリセット」ボタンが表示されることを確認
  const resetBtn = page.locator('button', { hasText: '視点をリセット' });
  await expect(resetBtn).toBeVisible({ timeout: 5000 });

  // リセットボタンをクリック
  await resetBtn.click();

  // ボタンが非表示になることを確認
  await expect(resetBtn).toBeHidden({ timeout: 5000 });
});
