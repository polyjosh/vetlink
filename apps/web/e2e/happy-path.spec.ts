import { expect, test, type Browser, type Page } from '@playwright/test';
import en from '../../../packages/i18n/src/locales/en.json' with { type: 'json' };
import sw from '../../../packages/i18n/src/locales/sw.json' with { type: 'json' };

// Seed users (apps/api/src/db/seed/fixtures.ts). Mock M-Pesa succeeds for numbers ending in 1.
// The UI follows each account's saved language: the seed farmer uses Swahili, the vet English.
const FARMER = '0700000001';
const VET = '0700000002';
const OTP = process.env.E2E_OTP ?? '123456';

async function signIn(browser: Browser, phone: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  // Signed out, the app starts in Swahili (the default).
  const a = sw.web.auth;
  await page.goto('/login');
  await page.getByLabel(a.phoneLabel).fill(phone);
  await page.getByRole('button', { name: a.sendCode }).click();
  await page.getByLabel(a.codeLabel).fill(OTP);
  await page.getByRole('button', { name: a.verify }).click();
  return page;
}

test('farmer books and pays, vet accepts and completes, farmer rates (M11 done-when)', async ({
  browser,
}) => {
  const vet = await signIn(browser, VET);
  await expect(vet).toHaveURL(/\/vet$/);
  await expect(vet.getByTestId('online-state')).toHaveText(en.web.vet.online);

  const farmer = await signIn(browser, FARMER);
  await expect(farmer).toHaveURL(/\/farmer$/);
  await farmer.getByRole('link', { name: sw.web.farmer.requestVet }).click();
  await farmer.getByRole('button', { name: sw.ussd.species.cattle, exact: true }).click();
  await farmer.getByRole('button', { name: sw.ussd.problems.sick, exact: true }).click();
  await farmer.getByLabel(sw.web.request.note).fill('Not eating since Monday');
  await farmer.getByRole('button', { name: sw.web.common.continue }).click();
  // "Fastest available vet": pay first, then the offer goes out in waves (§24.5).
  await farmer.getByRole('button', { name: new RegExp(sw.web.choose.fastest) }).click();
  const pay = farmer.getByRole('button', { name: /Thibitisha na ulipe/ });
  await expect(pay).toBeEnabled();
  await pay.click();

  // The server decides the payment (mock M-Pesa via the worker), then matching sends the offer.
  await expect(farmer).toHaveURL(/\/farmer\/bookings\/\d+$/);
  await expect(farmer.getByTestId('deposit-status')).toHaveText(sw.web.tracking.depositStatus.paid);

  const offer = vet.getByTestId('offer');
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: en.web.vet.accept }).click();
  await expect(farmer.getByTestId('booking-status')).toHaveText(sw.ussd.statuses.matched);

  await vet.getByRole('link', { name: new RegExp(en.ussd.statuses.matched) }).click();
  await expect(vet).toHaveURL(/\/vet\/jobs\/\d+$/);
  await vet.getByRole('button', { name: en.web.vet.onMyWay }).click();
  await expect(vet.getByTestId('job-status')).toHaveText(en.ussd.statuses.en_route);
  await vet.getByRole('button', { name: en.web.vet.arrived }).click();
  await expect(vet.getByTestId('job-status')).toHaveText(en.ussd.statuses.in_service);
  await vet.getByLabel(en.web.vet.diagnosis).fill('East Coast Fever');
  await vet.getByRole('button', { name: en.web.vet.complete }).click();
  await expect(vet.getByText(en.web.vet.completed)).toBeVisible();

  await expect(farmer.getByTestId('booking-status')).toHaveText(sw.ussd.statuses.done);
  await expect(farmer.getByText('East Coast Fever')).toBeVisible();
  await farmer.getByRole('radio', { name: '5' }).click();
  await farmer.getByRole('button', { name: sw.web.tracking.rateSubmit }).click();
  await expect(farmer.getByText(sw.web.tracking.rated)).toBeVisible();
});

test('a new number onboards as a farmer (language, consent, role, farm)', async ({ browser }) => {
  const page = await signIn(browser, '0700000021');
  await expect(page).toHaveURL(/\/onboarding$/);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: sw.web.common.english }).click();
  await page.getByRole('button', { name: en.web.common.next }).click();
  await page.getByRole('button', { name: en.web.onboarding.consentAgree }).click();
  await page.getByRole('button', { name: new RegExp(en.web.onboarding.roleFarmer) }).click();
  await page.getByRole('button', { name: en.web.common.next }).click();
  await page.getByLabel(en.web.onboarding.nameLabel).fill('Test Farmer');
  await page.getByLabel(en.web.onboarding.countyLabel).selectOption('Kiambu');
  await page.getByLabel(en.web.onboarding.wardLabel).selectOption({ index: 1 });
  await page.getByRole('button', { name: en.web.onboarding.finish }).click();
  await expect(page).toHaveURL(/\/farmer$/);
  await expect(page.getByRole('heading', { name: /Test Farmer/ })).toBeVisible();
});

test('the farmer chooses the vet; the booking fee is paid after the vet accepts', async ({
  browser,
}) => {
  const vet = await signIn(browser, VET);
  await expect(vet.getByTestId('online-state')).toHaveText(en.web.vet.online);
  const farmer = await signIn(browser, FARMER);
  await farmer.getByRole('link', { name: sw.web.farmer.requestVet }).click();
  await farmer.getByRole('button', { name: sw.ussd.species.cattle, exact: true }).click();
  await farmer.getByRole('button', { name: sw.ussd.problems.sick, exact: true }).click();
  await farmer.getByRole('button', { name: /Dr\. Demo Vet/ }).click();
  const send = farmer.getByRole('button', { name: sw.web.choose.sendRequest });
  await expect(send).toBeEnabled();
  await send.click();

  await expect(farmer).toHaveURL(/\/farmer\/bookings\/\d+$/);
  await expect(farmer.getByTestId('booking-status')).toHaveText(sw.ussd.statuses.requested);
  const offer = vet.getByTestId('offer');
  await expect(offer.getByText(en.web.choose.farmerChoseYou)).toBeVisible();
  await offer.getByRole('button', { name: en.web.vet.accept }).click();
  // Mock M-Pesa pays the prompt sent on acceptance; then the job is matched.
  await expect(farmer.getByTestId('booking-status')).toHaveText(sw.ussd.statuses.matched);
  await expect(farmer.getByTestId('deposit-status')).toHaveText(sw.web.tracking.depositStatus.paid);
});

test('the farmer books a vet for a later day (§24.10)', async ({ browser }) => {
  const farmer = await signIn(browser, FARMER);
  await farmer.getByRole('link', { name: sw.web.farmer.requestVet }).click();
  await farmer.getByRole('button', { name: sw.ussd.species.cattle, exact: true }).click();
  await farmer.getByRole('button', { name: sw.ussd.problems.vaccination, exact: true }).click();
  await farmer.getByRole('button', { name: sw.web.schedule.later }).click();
  // The seed vet works Monday to Saturday: pick the next such day after today (Nairobi).
  const day = new Date(Date.now() + 3 * 3600 * 1000);
  do day.setUTCDate(day.getUTCDate() + 1);
  while (day.getUTCDay() === 0);
  await farmer.getByLabel(sw.web.schedule.date).selectOption(day.toISOString().slice(0, 10));
  await farmer.getByRole('button', { name: sw.web.schedule.partLabels.morning }).click();
  await farmer.getByRole('button', { name: /Dr\. Demo Vet/ }).click();
  await farmer.getByRole('button', { name: sw.web.choose.sendRequest }).click();
  await expect(farmer).toHaveURL(/\/farmer\/bookings\/\d+$/);
  await expect(farmer.getByTestId('booking-status')).toHaveText(sw.ussd.statuses.requested);
  await expect(farmer.getByText(/📅/)).toBeVisible();
});
