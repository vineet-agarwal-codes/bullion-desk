import { expect, test } from '@playwright/test';

test.describe('BullionDesk v0.4.0 Hedge, Badla MTM & RTGS Fraud Shield', () => {
  test('Auto-hedges confirmed Peti deal, logs Badla unfixed position, and verifies/blocks RTGS', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('demo-login-admin').click();
    await page.getByTestId('nav-client-board').click();

    // 1. Place a 1 Peti (30kg) Silver order (auto-confirms in ~600ms)
    await page.getByTestId('buy-btn-silver-999-peti-cash').click();
    await page.getByTestId('submit-order-btn').click();
    await expect(page.getByTestId('order-status-toast')).toContainText('Confirmed', { timeout: 10000 });

    // 2. Navigate to Hedge & Risk Suite
    await page.getByTestId('nav-risk-suite').click();

    // Verify MCX auto-hedge execution was created
    await expect(page.getByTestId('hedge-executions-list')).toContainText('SILVER (30kg)');

    // 3. Log Badla Unfixed Position
    await page.getByTestId('add-unfixed-btn').click();
    await expect(page.getByTestId('unfixed-list')).toContainText('50.0 kg SILVER');

    // 4. Test RTGS Fraud Shield: first mismatched name -> BLOCKED, then matched -> VERIFIED + Delivery Token
    await page.getByTestId('rtgs-remitter-input').fill('UNKNOWN FRAUD TRADERS');
    await page.getByTestId('verify-rtgs-btn').click();
    await expect(page.getByTestId('rtgs-results-list')).toContainText('BLOCKED_NAME_MISMATCH');

    await page.getByTestId('rtgs-remitter-input').fill('MEHRA SONS BULLION PVT LTD');
    await page.getByTestId('verify-rtgs-btn').click();
    await expect(page.getByTestId('rtgs-results-list')).toContainText('BD-DEL-');
  });
});
