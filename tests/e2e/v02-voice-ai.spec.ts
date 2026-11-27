import { expect, test } from '@playwright/test';

test.describe('BullionDesk v0.2.0 AI Voice & Context Commands', () => {
  test('Dealer uses Hinglish voice/text command with preview confirmation and context carryover', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('demo-login-admin').click();
    await expect(page.getByTestId('nav-dealer-desk')).toBeVisible();

    // 1. Initial Silver 999 Cash offset is +450
    await expect(page.getByTestId('offset-val-silver-999-cash')).toHaveText('+450');

    // 2. Send Hinglish command -> Preview appears -> Confirm & Run
    await page.getByTestId('voice-input-dealer').fill('Silver cash 100 rupaye badha do');
    await page.getByTestId('voice-submit-dealer').click();
    await expect(page.getByTestId('voice-preview-dealer')).toBeVisible();
    await page.getByTestId('voice-confirm-dealer').click();
    await expect(page.getByTestId('voice-result-dealer')).toContainText('SILVER_999_CASH');
    await expect(page.getByTestId('offset-val-silver-999-cash')).toHaveText('+550');

    // 3. Send ambiguous follow-up without metal/settlement -> Preview resolves context -> Confirm
    await page.getByTestId('voice-input-dealer').fill('Aur 50 kam kar do');
    await page.getByTestId('voice-submit-dealer').click();
    await expect(page.getByTestId('voice-preview-dealer')).toContainText('CONTEXT RESOLVED');
    await page.getByTestId('voice-confirm-dealer').click();
    await expect(page.getByTestId('voice-result-dealer')).toContainText('CONTEXT RESOLVED');
    await expect(page.getByTestId('offset-val-silver-999-cash')).toHaveText('+500');
  });
});
