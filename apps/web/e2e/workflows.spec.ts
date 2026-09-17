import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { testDatabase, fixture, challenge, testImage } from '../../api/test/fixtures';
import { totpCode } from '../../api/src/common/totp';
const prisma = testDatabase();
const STAFF_TOTP = 'JBSWY3DPEHPK3PXP';
const api = process.env.TEST_API_URL ?? 'http://localhost:4100';
let owner: Awaited<ReturnType<typeof fixture>>,
  buyer: Awaited<ReturnType<typeof fixture>>,
  editor: Awaited<ReturnType<typeof fixture>>;
let cityId = '',
  listingId = '';
async function login(page: Page, email: string, mfaSecret?: string) {
  await challenge(prisma, email);
  await page.goto('/en/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send code', exact: true }).click();
  await expect(page.getByLabel('Code', { exact: true })).toBeVisible();
  // Replace only the delivery challenge in the isolated test DB; exercise the real browser form.
  await challenge(prisma, email);
  await page.getByLabel('Code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  if (mfaSecret) {
    // Staff accounts land on the TOTP challenge before tokens are issued.
    await page.getByLabel('Authenticator code', { exact: true }).fill(totpCode(mfaSecret));
    await page.getByRole('button', { name: 'Verify & sign in', exact: true }).click();
  }
  await expect(page).toHaveURL(/\/en$/);
  await page.goto('/en/me');
  await expect(page.getByRole('heading', { name: 'Me', exact: true })).toBeVisible();
}
test.beforeAll(async () => {
  owner = await fixture(prisma);
  buyer = await fixture(prisma);
  editor = await fixture(prisma, 'editor');
  // StaffMfaGuard requires enrolled TOTP on staff surfaces.
  await prisma.user.update({
    where: { id: editor.id },
    data: { totpSecret: STAFF_TOTP, totpEnabledAt: new Date() },
  });
  cityId = (
    await prisma.city.create({
      data: {
        slug: `browser-${randomUUID()}`,
        state: 'NSW',
        nameZh: '测试城市',
        nameEn: 'Browser City',
        timezone: 'Australia/Sydney',
        isLaunch: true,
      },
    })
  ).id;
  listingId = (
    await prisma.listing.create({
      data: {
        ownerId: owner.id,
        type: 'item',
        title: 'Browser test desk',
        body: 'A desk used for browser acceptance tests.',
        cityId,
        status: 'active',
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        item: {
          create: {
            category: 'furniture',
            condition: 'good',
            deliveryMethods: ['pickup'],
            suburb: 'Sydney',
          },
        },
      },
    })
  ).id;
});
test.afterAll(async () => {
  const ids = [owner, buyer, editor].filter(Boolean).map((u) => u.id);
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.message.deleteMany({ where: { senderId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { buyerId: { in: ids } } });
  await prisma.media.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.listing.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.article.deleteMany({ where: { authorId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.mfaChallenge.deleteMany({ where: { userId: { in: ids } } });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.otpChallenge.deleteMany({
    where: { email: { in: [owner, buyer, editor].filter(Boolean).map((u) => u.email) } },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  if (cityId) await prisma.city.delete({ where: { id: cityId } });
  await prisma.$disconnect();
});
test('owner edits and pauses a listing without falling into a public 404', async ({ page }) => {
  await login(page, owner.email);
  await page.getByRole('link', { name: 'Edit & photos' }).click();
  await expect(page.getByRole('heading', { name: 'Edit & photos' })).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill('Browser edited desk');
  await page.getByLabel('Upload photo').setInputFiles({
    name: 'desk.png',
    mimeType: 'image/png',
    buffer: await testImage(),
  });
  await expect(page.getByRole('img', { name: 'Listing photo 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove photo', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Listing photo 1' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/me$/);
  await expect(page.getByRole('link', { name: 'Browser edited desk' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});
test('buyer contacts owner and sends a message', async ({ page }) => {
  await login(page, buyer.email);
  await page.goto(`/en/market/${listingId}`);
  await page.getByRole('button', { name: 'Contact owner', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/messages\?conversation=/);
  await page.getByLabel('Message', { exact: true }).fill('Hello from the browser');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
  await expect(
    page.locator('[aria-live="polite"]').getByText('Hello from the browser', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/messages.png', fullPage: true });
});
test('CMS creates an article and ordinary users cannot enter admin', async ({ page }) => {
  await login(page, owner.email);
  await page.goto('/en/admin');
  await expect(page.getByText('Your account does not have access')).toBeVisible();
  await login(page, editor.email, STAFF_TOTP);
  await page.goto('/en/admin');
  await page.getByLabel('URL slug (lowercase letters and hyphens)').fill(`browser-${randomUUID()}`);
  await page.getByLabel('Summary', { exact: true }).fill('A browser authored article summary.');
  await page.getByLabel('Body', { exact: true }).fill('A browser authored article body.');
  // The title field is independently labelled from the page heading.
  await page
    .locator('form')
    .getByLabel('Article title', { exact: true })
    .fill('Browser CMS article');
  await page.getByRole('button', { name: 'Save article', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
});
test('Chinese screens render translated navigation and login remains usable', async ({ page }) => {
  await page.goto('/zh/login');
  await expect(page.getByRole('heading', { name: '邮箱登录' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('MISSING_MESSAGE');
  await page.screenshot({ path: 'test-results/zh-login.png', fullPage: true });
});
