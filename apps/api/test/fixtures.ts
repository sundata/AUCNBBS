import sharp from 'sharp';
import { PrismaClient, type Role } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
export function testDatabase() {
  const url = process.env.DATABASE_URL ?? '';
  if (!new URL(url).pathname.endsWith('_test'))
    throw new Error('Tests require a database whose name ends with _test');
  return new PrismaClient();
}
export async function fixture(prisma: PrismaClient, role: Role = 'member') {
  const email = `test-${randomUUID()}@example.com`;
  const user = await prisma.user.create({
    data: {
      displayName: `Test ${role}`,
      role,
      identities: {
        create: { provider: 'email_otp', providerSubject: email, verifiedAt: new Date() },
      },
    },
  });
  await challenge(prisma, email);
  return { ...user, email };
}
export async function challenge(prisma: PrismaClient, email: string) {
  await prisma.otpChallenge.create({
    data: {
      email,
      codeHash: createHash('sha256').update(`${email}:123456`).digest('hex'),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
}

export function testImage() {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
}
