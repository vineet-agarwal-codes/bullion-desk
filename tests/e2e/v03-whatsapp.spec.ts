import { expect, test } from '@playwright/test';

test.describe('BullionDesk v0.3.0 WhatsApp Agents', () => {
  test('Sub-Dealer checks rates, places & confirms order on WhatsApp; Owner updates price on WhatsApp', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('demo-login-admin').click();
    const beforeOffsetText = await page.getByTestId('offset-val-silver-999-cash').innerText();
    const beforeOffset = Number(beforeOffsetText.replace('+', ''));

    await page.getByTestId('nav-whatsapp').click();

    // 1. Sub-Dealer checks live rates
    await page.getByTestId('wa-message-input').fill('rate kya hai');
    await page.getByTestId('wa-send-btn').click();
    await expect(page.getByTestId('wa-chat-history')).toContainText('Live BullionDesk Rates');

    // 2. Sub-Dealer books 1 peti silver & confirms with HAA
    await page.getByTestId('wa-message-input').fill('1 peti chandi pakki kar do');
    await page.getByTestId('wa-send-btn').click();
    await expect(page.getByTestId('wa-chat-history')).toContainText('Reply HAA within 15s');

    await page.getByTestId('wa-message-input').fill('HAA');
    await page.getByTestId('wa-send-btn').click();
    await expect(page.getByTestId('wa-chat-history')).toContainText('Sauda Confirmed');

    // 3. Switch to Owner identity and adjust Silver Cash +100
    await page.getByTestId('wa-identity-owner').click();
    await page.getByTestId('wa-message-input').fill('Silver cash +100');
    await page.getByTestId('wa-send-btn').click();
    await expect(page.getByTestId('wa-chat-history')).toContainText('Owner Desk Updated');

    // 4. Verify in Dealer Desk that Silver Cash offset increased by +100
    await page.getByTestId('nav-dealer-desk').click();
    const expected = beforeOffset + 100;
    await expect(page.getByTestId('offset-val-silver-999-cash')).toHaveText(
      expected >= 0 ? `+${expected}` : `${expected}`
    );
  });
});
