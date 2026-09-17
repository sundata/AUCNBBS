import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { testDatabase, fixture } from '../../api/test/fixtures';
const prisma = testDatabase();
let cityId = '';
let ownerId = '';
let ownerEmail = '';
test.beforeAll(async () => {
  cityId = (
    await prisma.city.create({
      data: {
        slug: `a11y-${randomUUID()}`,
        state: 'NSW',
        nameZh: '无障碍城市',
        nameEn: 'A11y City',
        timezone: 'Australia/Sydney',
        isLaunch: true,
      },
    })
  ).id;
  const owner = await fixture(prisma);
  ownerId = owner.id;
  ownerEmail = owner.email;
  await prisma.listing.create({
    data: {
      ownerId: owner.id,
      type: 'item',
      title: 'A11y test desk',
      body: 'A desk used for accessibility scans.',
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
  });
});
test.afterAll(async () => {
  await prisma.listing.deleteMany({ where: { cityId } });
  if (ownerId) {
    await prisma.identity.deleteMany({ where: { userId: ownerId } });
    await prisma.otpChallenge.deleteMany({ where: { email: ownerEmail } });
    await prisma.user.delete({ where: { id: ownerId } });
  }
  await prisma.city.delete({ where: { id: cityId } });
  await prisma.$disconnect();
});
// W-11: automated WCAG scan over the primary public surfaces. Serious and
// critical violations fail the build; minor/moderate are surfaced in output.
for (const path of ['/en', '/zh', '/en/login', '/en/market', '/en/community', '/en/news']) {
  test(`a11y ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const serious = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? ''),
    );
    expect(serious, serious.map((v) => `${v.id}: ${v.nodes.length} nodes`).join('\n')).toHaveLength(
      0,
    );
  });
}
