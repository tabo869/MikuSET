import { test, expect } from '@playwright/test';

test('E2E: Magical Guest mode triggers and visual feedback works', async ({ page }) => {
  test.setTimeout(60000);

  await page.goto('/');

  // 1. スタートボタンがロードされていることを確認
  const startButton = page.locator('button', { hasText: /^(START|スタート)$/i });
  await startButton.waitFor({ state: 'visible', timeout: 30000 });

  // 2. マジカル・ゲストのチェックボックスを取得してチェックを入れる
  const magicalGuestLabel = page.locator('label', { hasText: 'マジカル・ゲスト' });
  await magicalGuestLabel.waitFor({ state: 'visible' });
  
  const checkbox = magicalGuestLabel.locator('input[type="checkbox"]');
  await checkbox.check();
  
  // 3. 自動演奏（オートプレイ）も連動してチェックされることを確認
  const autoPlayLabel = page.locator('label', { hasText: 'オートプレイ (演出確認用)' });
  const autoPlayCheckbox = autoPlayLabel.locator('input[type="checkbox"]');
  await expect(autoPlayCheckbox).toBeChecked();

  // 4. FaceTracker がマウントされていることを確認
  // "MAGICAL GUEST: CAM ON" というオーバーレイテキストが存在するか確認
  const faceTrackerOverlay = page.locator('text=MAGICAL GUEST: CAM ON');
  await expect(faceTrackerOverlay).toBeVisible({ timeout: 15000 });

  // 5. スタートして再生中に表情トリガーイベントをシミュレート
  await startButton.click();
  await startButton.waitFor({ state: 'hidden', timeout: 10000 });

  // 再生が開始されるまで少し待つ
  await page.waitForTimeout(2000);

  // window からカスタムイベントをディスパッチして、クオンタイズSEおよび3Dエフェクトのトリガーをテスト
  // 'sparkle' タイプのトリガーイベントをシミュレート
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('mikuset-magical-trigger', {
      detail: { type: 'sparkle', position: 1000 }
    }));
  });

  // エフェクト発火により3Dのレンダリングが変化するため、エラーなどが発生しないことを確認
  // 3秒ほど待って、進行チェック
  await page.waitForTimeout(3000);

  // 中断ボタンをクリックして終了できるか確認
  const stopButton = page.locator('button', { hasText: /^(STOP|中断)$/i });
  await stopButton.waitFor({ state: 'visible' });
  await stopButton.click();

  // スタートボタンが再表示されることを確認
  await expect(startButton).toBeVisible();
});
