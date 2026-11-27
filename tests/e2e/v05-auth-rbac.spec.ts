import { expect, test } from '@playwright/test';

test.describe('BullionDesk v0.5.0 Auth & RBAC Isolation', () => {
  test('Sub-Dealer only sees own data and cannot access Admin Desk, Risk Suite, or other sub-dealers', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Sign in as Sub-Dealer (Agarwal Payal) using credentials
    await page.getByTestId('login-username').fill('agarwal');
    await page.getByTestId('login-password').fill('agarwal123');
    await page.getByTestId('login-submit').click();

    // 2. Verify own firm is shown without a client-switcher dropdown
    await expect(page.getByTestId('logged-in-firm')).toContainText('Agarwal Payal & Bullion');
    await expect(page.getByTestId('client-selector')).toHaveCount(0);

    // 3. Verify Admin tabs are completely hidden for SUB_DEALER
    await expect(page.getByTestId('nav-dealer-desk')).toHaveCount(0);
    await expect(page.getByTestId('nav-risk-suite')).toHaveCount(0);

    // 4. Verify COMEX Gold and USD/INR are removed from ticker strip
    await expect(page.locator('body')).not.toContainText('COMEX GOLD');
    await expect(page.locator('body')).not.toContainText('USD/INR');
  });
});
