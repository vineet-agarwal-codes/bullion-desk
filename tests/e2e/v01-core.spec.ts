import { expect, test } from '@playwright/test';

test.describe('BullionDesk v0.1.0 Core Flow', () => {
  test('Dealer adjusts price, toggles Kill Switch, and Sub-Dealer places & confirms Market Order', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Sub-dealer sees live Gold 999 RTGS & Silver 999 Cash rates
    await expect(page.getByTestId('mcx-gold-tick')).toBeVisible();
    await expect(page.getByTestId('rate-row-gold-999-rtgs')).toBeVisible();
    await expect(page.getByTestId('rate-row-silver-999-cash')).toBeVisible();

    const initialSellText = await page.getByTestId('buy-btn-gold-999-rtgs').innerText();
    const initialSellVal = Number(initialSellText.replace(/[₹,]/g, ''));

    // 2. Switch to Dealer Admin Desk & adjust Gold 999 RTGS offset by +100
    await page.getByTestId('nav-dealer-desk').click();
    await page.getByTestId('adjust-gold-999-rtgs-100').click();
    await expect(page.getByTestId('offset-val-gold-999-rtgs')).toHaveText('+350');

    // 3. Switch back to Sub-Dealer Rate Board and verify rate increased (within tick tolerance, ~+100)
    await page.getByTestId('nav-client-board').click();
    const updatedSellText = await page.getByTestId('buy-btn-gold-999-rtgs').innerText();
    const updatedSellVal = Number(updatedSellText.replace(/[₹,]/g, ''));
    expect(updatedSellVal).toBeGreaterThan(initialSellVal + 30);

    // 4. Test Kill Switch (Freeze & Unfreeze)
    await page.getByTestId('nav-dealer-desk').click();
    await page.getByTestId('kill-switch-btn').click();
    await expect(page.getByTestId('market-status-badge')).toContainText('FROZEN');

    await page.getByTestId('nav-client-board').click();
    await expect(page.getByTestId('rate-row-gold-999-rtgs')).toContainText('CALL FOR RATE');

    // Unfreeze
    await page.getByTestId('nav-dealer-desk').click();
    await page.getByTestId('kill-switch-btn').click();
    await expect(page.getByTestId('market-status-badge')).toContainText('TRADING ACTIVE');

    // 5. Sub-dealer places a Market BUY order and confirms it
    await page.getByTestId('nav-client-board').click();
    await page.getByTestId('buy-btn-gold-999-rtgs').click();
    await expect(page.getByTestId('order-ticket-modal')).toBeVisible();
    await page.getByTestId('order-qty-input').fill('2');
    await page.getByTestId('submit-order-btn').click();

    // 6. Pending confirmation banner appears -> Confirm Sauda
    await expect(page.getByTestId('pending-confirm-banner')).toBeVisible();
    await page.getByTestId('confirm-deal-btn').click();

    // 7. Verify Dual Ledger updated (20.00 g Gold)
    await expect(page.getByTestId('client-gold-balance')).toContainText('20.00 g');
  });
});
