import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  favoriteSchema,
  followSchema,
  savedSearchSchema,
  updateSavedSearchSchema,
  FAVORITE_SUBJECT_TYPES,
  FOLLOW_SUBJECT_TYPES,
  FavoriteSubjectType,
  FollowSubjectType,
} from '@aucn/domain';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { cursorQuerySchema, CursorQuery, decodeCursor, toPage } from '../../common/pagination';
import { AuthGuard } from '../auth/auth.guard';
import { AccessTokenPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_LISTING_STATUSES } from '@aucn/domain';

const subjectParamsSchema = z.object({
  subjectType: z.string(),
  subjectId: z.string().uuid(),
});

const favoritesQuery = cursorQuerySchema.extend({
  subjectType: z.enum(FAVORITE_SUBJECT_TYPES).optional(),
});
const followsQuery = cursorQuerySchema.extend({
  subjectType: z.enum(FOLLOW_SUBJECT_TYPES).optional(),
});

@ApiTags('social')
@ApiBearerAuth()
@Controller({ path: 'me', version: '1' })
@UseGuards(AuthGuard)
export class SocialController {
  constructor(private readonly prisma: PrismaService) {}

  private pageWhere(query: CursorQuery) {
    const c = decodeCursor(query.cursor);
    return c
      ? { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] }
      : {};
  }

  private async assertFavoriteSubject(type: FavoriteSubjectType, id: string, userId: string) {
    const exists =
      type === 'listing'
        ? await this.prisma.listing.findFirst({
            where: {
              id,
              OR: [
                { status: { in: [...PUBLIC_LISTING_STATUSES] }, expiresAt: { gt: new Date() } },
                { ownerId: userId },
              ],
            },
            select: { id: true },
          })
        : type === 'post'
          ? await this.prisma.post.findFirst({
              where: { id, status: 'published' },
              select: { id: true },
            })
          : type === 'article'
            ? await this.prisma.article.findFirst({
                where: { id, status: 'published' },
                select: { id: true },
              })
            : type === 'business'
              ? await this.prisma.business.findFirst({
                  where: { id, status: 'active' },
                  select: { id: true },
                })
              : await this.prisma.event.findFirst({
                  where: { id, status: 'published' },
                  select: { id: true },
                });
    if (!exists) throw new NotFoundException('Subject not found');
  }

  private async assertFollowSubject(type: FollowSubjectType, id: string) {
    const exists =
      type === 'user'
        ? await this.prisma.user.findFirst({
            where: { id, status: 'active' },
            select: { id: true },
          })
        : type === 'board'
          ? await this.prisma.board.findUnique({ where: { id }, select: { id: true } })
          : await this.prisma.business.findFirst({
              where: { id, status: 'active' },
              select: { id: true },
            });
    if (!exists) throw new NotFoundException('Subject not found');
  }

  // ---------- Favorites ----------

  @Post('favorites')
  async addFavorite(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(favoriteSchema)) body: z.infer<typeof favoriteSchema>,
  ) {
    await this.assertFavoriteSubject(body.subjectType, body.subjectId, user.sub);
    await this.prisma.favorite.upsert({
      where: {
        userId_subjectType_subjectId: {
          userId: user.sub,
          subjectType: body.subjectType,
          subjectId: body.subjectId,
        },
      },
      update: {},
      create: { userId: user.sub, ...body },
    });
    return { favorited: true };
  }

  @Delete('favorites/:subjectType/:subjectId')
  async removeFavorite(
    @CurrentUser() user: AccessTokenPayload,
    @Param(new ZodPipe(subjectParamsSchema)) params: z.infer<typeof subjectParamsSchema>,
  ) {
    await this.prisma.favorite.deleteMany({
      where: {
        userId: user.sub,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
      },
    });
    return { favorited: false };
  }

  @Get('favorites/:subjectType/:subjectId')
  async favoriteState(
    @CurrentUser() user: AccessTokenPayload,
    @Param(new ZodPipe(subjectParamsSchema)) params: z.infer<typeof subjectParamsSchema>,
  ) {
    const row = await this.prisma.favorite.findUnique({
      where: {
        userId_subjectType_subjectId: {
          userId: user.sub,
          subjectType: params.subjectType,
          subjectId: params.subjectId,
        },
      },
      select: { id: true },
    });
    return { favorited: !!row };
  }

  @Get('favorites')
  async favorites(
    @CurrentUser() user: AccessTokenPayload,
    @Query(new ZodPipe(favoritesQuery)) query: z.infer<typeof favoritesQuery>,
  ) {
    const rows = await this.prisma.favorite.findMany({
      where: {
        userId: user.sub,
        ...(query.subjectType ? { subjectType: query.subjectType } : {}),
        ...this.pageWhere(query),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const titles = await this.resolveTitles(rows.map((r) => [r.subjectType, r.subjectId]));
    return toPage(
      rows.map((r) => ({
        ...r,
        title: titles.get(`${r.subjectType}:${r.subjectId}`)?.title ?? null,
        subjectMeta: titles.get(`${r.subjectType}:${r.subjectId}`)?.meta ?? null,
      })),
      query.limit,
    );
  }

  /** Resolve display titles (and listing type for routing) in a handful of batched queries. */
  private async resolveTitles(
    pairs: [string, string][],
  ): Promise<Map<string, { title: string; meta: string | null }>> {
    const byType = new Map<string, string[]>();
    for (const [type, id] of pairs) {
      const list = byType.get(type) ?? [];
      list.push(id);
      byType.set(type, list);
    }
    const titles = new Map<string, { title: string; meta: string | null }>();
    const load = async (
      type: string,
      rows: { id: string; title?: string | null; nameZh?: string; type?: string }[],
    ) => {
      for (const row of rows)
        titles.set(`${type}:${row.id}`, {
          title: row.title ?? row.nameZh ?? row.id,
          meta: row.type ?? null,
        });
    };
    if (byType.get('listing'))
      await load(
        'listing',
        await this.prisma.listing.findMany({
          where: { id: { in: byType.get('listing')! } },
          select: { id: true, title: true, type: true },
        }),
      );
    if (byType.get('post'))
      await load(
        'post',
        await this.prisma.post.findMany({
          where: { id: { in: byType.get('post')! } },
          select: { id: true, title: true },
        }),
      );
    if (byType.get('article'))
      await load(
        'article',
        await this.prisma.article.findMany({
          where: { id: { in: byType.get('article')! } },
          select: { id: true, title: true },
        }),
      );
    if (byType.get('business'))
      await load(
        'business',
        await this.prisma.business.findMany({
          where: { id: { in: byType.get('business')! } },
          select: { id: true, nameZh: true },
        }),
      );
    if (byType.get('event'))
      await load(
        'event',
        await this.prisma.event.findMany({
          where: { id: { in: byType.get('event')! } },
          select: { id: true, title: true },
        }),
      );
    return titles;
  }

  // ---------- Follows ----------

  @Post('follows')
  async addFollow(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(followSchema)) body: z.infer<typeof followSchema>,
  ) {
    if (body.subjectType === 'user' && body.subjectId === user.sub)
      throw new NotFoundException('Cannot follow yourself');
    await this.assertFollowSubject(body.subjectType, body.subjectId);
    await this.prisma.follow.upsert({
      where: {
        userId_subjectType_subjectId: {
          userId: user.sub,
          subjectType: body.subjectType,
          subjectId: body.subjectId,
        },
      },
      update: {},
      create: { userId: user.sub, ...body },
    });
    return { following: true };
  }

  @Delete('follows/:subjectType/:subjectId')
  async removeFollow(
    @CurrentUser() user: AccessTokenPayload,
    @Param(new ZodPipe(subjectParamsSchema)) params: z.infer<typeof subjectParamsSchema>,
  ) {
    await this.prisma.follow.deleteMany({
      where: {
        userId: user.sub,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
      },
    });
    return { following: false };
  }

  @Get('follows/:subjectType/:subjectId')
  async followState(
    @CurrentUser() user: AccessTokenPayload,
    @Param(new ZodPipe(subjectParamsSchema)) params: z.infer<typeof subjectParamsSchema>,
  ) {
    const row = await this.prisma.follow.findUnique({
      where: {
        userId_subjectType_subjectId: {
          userId: user.sub,
          subjectType: params.subjectType,
          subjectId: params.subjectId,
        },
      },
      select: { id: true },
    });
    return { following: !!row };
  }

  @Get('follows')
  async follows(
    @CurrentUser() user: AccessTokenPayload,
    @Query(new ZodPipe(followsQuery)) query: z.infer<typeof followsQuery>,
  ) {
    const rows = await this.prisma.follow.findMany({
      where: {
        userId: user.sub,
        ...(query.subjectType ? { subjectType: query.subjectType } : {}),
        ...this.pageWhere(query),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit);
  }

  // ---------- Saved searches ----------

  @Get('saved-searches')
  async savedSearches(@CurrentUser() user: AccessTokenPayload) {
    return {
      items: await this.prisma.savedSearch.findMany({
        where: { userId: user.sub },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    };
  }

  @Post('saved-searches')
  async createSavedSearch(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(savedSearchSchema)) body: z.infer<typeof savedSearchSchema>,
  ) {
    const count = await this.prisma.savedSearch.count({ where: { userId: user.sub } });
    if (count >= 50) throw new NotFoundException('Saved search limit reached');
    return this.prisma.savedSearch.create({
      data: {
        userId: user.sub,
        name: body.name,
        query: body.query,
        cadence: body.cadence,
        filters: body.filters as Prisma.InputJsonValue | undefined,
      },
    });
  }

  @Patch('saved-searches/:id')
  async updateSavedSearch(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateSavedSearchSchema)) body: z.infer<typeof updateSavedSearchSchema>,
  ) {
    const result = await this.prisma.savedSearch.updateMany({
      where: { id, userId: user.sub },
      data: body,
    });
    if (!result.count) throw new NotFoundException();
    return this.prisma.savedSearch.findUnique({ where: { id } });
  }

  @Delete('saved-searches/:id')
  async deleteSavedSearch(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.prisma.savedSearch.deleteMany({
      where: { id, userId: user.sub },
    });
    if (!result.count) throw new NotFoundException();
    return { ok: true };
  }
}
