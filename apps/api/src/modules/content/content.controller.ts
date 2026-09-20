import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { cursorQuerySchema, decodeCursor, Page, toPage } from '../../common/pagination';
import { ZodPipe } from '../../common/zod.pipe';
import { articleCoverSvg } from '../../common/cover-svg';
import { PrismaService } from '../prisma/prisma.service';

export interface ArticleSummaryDto {
  id: string;
  slug: string;
  category: string;
  title: string;
  summary: string;
  coverUrl: string | null;
  publishedAt: string | null;
  createdAt: Date;
}

export interface ArticleDetailDto extends ArticleSummaryDto {
  body: string;
  source: string | null;
  author: { id: string; displayName: string };
}

const articlesQuerySchema = cursorQuerySchema.extend({ category: z.string().optional() });

@ApiTags('content')
@Controller({ path: 'articles', version: '1' })
export class ContentController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query(new ZodPipe(articlesQuerySchema)) query: z.infer<typeof articlesQuerySchema>,
  ): Promise<Page<ArticleSummaryDto>> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.article.findMany({
      where: {
        status: 'published',
        ...(query.category ? { category: query.category } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return toPage(
      rows.map((a) => ({
        id: a.id,
        slug: a.slug,
        category: a.category,
        title: a.title,
        summary: a.summary,
        coverUrl: a.coverUrl,
        publishedAt: a.publishedAt?.toISOString() ?? null,
        createdAt: a.createdAt,
      })),
      query.limit,
    );
  }

  @Get(':slug/cover.svg')
  async cover(@Param('slug') slug: string, @Res() res: Response) {
    const a = await this.prisma.article.findFirst({
      where: { slug, status: 'published' },
      select: { title: true },
    });
    if (!a) throw new NotFoundException('Article not found');
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(articleCoverSvg(a.title, slug));
  }

  @Get(':slug')
  async detail(@Param('slug') slug: string): Promise<ArticleDetailDto> {
    const a = await this.prisma.article.findFirst({
      where: { slug, status: 'published' },
      include: { author: { select: { id: true, displayName: true } } },
    });
    if (!a) throw new NotFoundException('Article not found');
    return {
      id: a.id,
      slug: a.slug,
      category: a.category,
      title: a.title,
      summary: a.summary,
      coverUrl: a.coverUrl,
      publishedAt: a.publishedAt?.toISOString() ?? null,
      createdAt: a.createdAt,
      body: a.body,
      source: a.source,
      author: a.author,
    };
  }
}
