import { Body, Controller, Get, NotFoundException, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { updateProfileSchema } from '@aucn/domain';
import type { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { AccessTokenPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

export interface MeDto {
  id: string;
  displayName: string;
  role: string;
  locale: string;
  bio: string | null;
  homeCityId: string | null;
  email: string | null;
  createdAt: string;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller({ path: 'me', version: '1' })
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async me(@CurrentUser() user: AccessTokenPayload): Promise<MeDto> {
    const row = await this.prisma.user.findUnique({
      where: { id: user.sub },
      include: { identities: { where: { provider: 'email_otp', revokedAt: null }, take: 1 } },
    });
    if (!row) throw new NotFoundException();
    return {
      id: row.id,
      displayName: row.displayName,
      role: row.role,
      locale: row.locale,
      bio: row.bio,
      homeCityId: row.homeCityId,
      email: row.identities[0]?.providerSubject ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  @Patch()
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(updateProfileSchema)) body: z.infer<typeof updateProfileSchema>,
  ): Promise<MeDto> {
    await this.prisma.user.update({ where: { id: user.sub }, data: body });
    return this.me(user);
  }
}
