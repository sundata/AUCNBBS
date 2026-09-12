import { PrismaClient, Role } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });
const [email, role] = process.argv.slice(2);
if (!email || !['editor', 'moderator', 'admin'].includes(role))
  throw new Error(
    'Usage: pnpm --filter @aucn/api admin:grant <existing-email> <editor|moderator|admin>',
  );
const prisma = new PrismaClient();
async function main() {
  const identity = await prisma.identity.findUnique({
    where: {
      provider_providerAppId_providerSubject: {
        provider: 'email_otp',
        providerAppId: '',
        providerSubject: email.toLowerCase(),
      },
    },
    include: { user: true },
  });
  if (!identity || identity.revokedAt || identity.user.status !== 'active')
    throw new Error('Active verified email identity not found');
  await prisma.$transaction([
    prisma.user.update({ where: { id: identity.userId }, data: { role: role as Role } }),
    prisma.auditLog.create({
      data: {
        action: 'role.grant.cli',
        subject: `user:${identity.userId}`,
        reason: 'Operator CLI role grant',
        metadata: { previousRole: identity.user.role, newRole: role },
      },
    }),
  ]);
  console.log('Role updated and audited.');
}
main().finally(() => prisma.$disconnect());
