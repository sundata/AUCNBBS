import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
  HttpCode,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import sharp from 'sharp';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard, StaffMfaGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AccessTokenPayload } from '../auth/auth.service';
import { ZodPipe } from '../../common/zod.pipe';
import { dailyNoteInput, noteSelect } from './daily-notes.schema';
import { DeliveryGuard } from './delivery.guard';
const pageQuery = z.object({
  city: z.enum(['melbourne', 'tokyo', 'both']).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
const reviewInput = z
  .object({ status: z.enum(['draft', 'published', 'hidden']), updatedAt: z.string().datetime() })
  .strict();
function editor(u: AccessTokenPayload) {
  if (!['editor', 'admin', 'super_admin'].includes(u.role)) throw new ForbiddenException();
}
@Controller({ path: 'daily-notes', version: '1' })
export class DailyNotesController {
  constructor(private readonly prisma: PrismaService) {}
  @Post('import')
  @HttpCode(200)
  @UseGuards(DeliveryGuard)
  @UseInterceptors(
    FileInterceptor('cover', {
      limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 1, fieldSize: 150000, parts: 2 },
    }),
  )
  async ingest(@Body('payload') raw: unknown, @UploadedFile() file?: Express.Multer.File) {
    let input: z.infer<typeof dailyNoteInput>;
    try {
      input = dailyNoteInput.parse(JSON.parse(typeof raw === 'string' ? raw : ''));
    } catch {
      throw new UnprocessableEntityException('Invalid daily-note payload');
    }
    if (!file) throw new UnprocessableEntityException('A cover image is required');
    // Hash the validated content and original bytes; resending is safe across encoder upgrades.
    const digest = createHash('sha256')
      .update(JSON.stringify(input))
      .update(file.buffer)
      .digest('hex');
    const old = await this.prisma.dailyNote.findUnique({
      where: { deliveryId: input.deliveryId },
      select: { id: true, digest: true, status: true },
    });
    if (old) {
      if (old.digest !== digest)
        throw new ConflictException('Delivery ID already contains different content');
      return { id: old.id, status: old.status, duplicate: true };
    }
    let cover: Buffer;
    try {
      const img = sharp(file.buffer, { limitInputPixels: 25_000_000, animated: false });
      const meta = await img.metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1)
        throw new Error();
      cover = await img
        .rotate()
        .resize({ width: 1200, height: 1800, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      if (cover.length > 1024 * 1024) throw new Error();
    } catch {
      throw new UnprocessableEntityException(
        'Use a valid JPEG, PNG or WebP cover (max 25 megapixels, 1 MB after processing)',
      );
    }
    const status = process.env.DAILY_NOTES_AUTO_PUBLISH === 'true' ? 'published' : 'draft';
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.dailyNote.create({
          data: {
            ...input,
            digest,
            cover: new Uint8Array(cover),
            status,
            publishedAt: status === 'published' ? new Date() : null,
          },
          select: { id: true, status: true },
        });
        await tx.auditLog.create({
          data: {
            action: 'daily-note.import',
            subject: row.id,
            metadata: { deliveryId: input.deliveryId, status },
          },
        });
        return { ...row, duplicate: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const row = await this.prisma.dailyNote.findUniqueOrThrow({
          where: { deliveryId: input.deliveryId },
          select: { id: true, digest: true, status: true },
        });
        if (row.digest !== digest)
          throw new ConflictException('Delivery ID already contains different content');
        return { id: row.id, status: row.status, duplicate: true };
      }
      throw error;
    }
  }
  @Get()
  async list(@Query(new ZodPipe(pageQuery)) query: z.infer<typeof pageQuery>) {
    const where = {
      status: 'published',
      ...(query.city
        ? { city: query.city === 'both' ? 'both' : { in: [query.city, 'both'] } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.dailyNote.findMany({
        where,
        select: { ...noteSelect, body: false },
        orderBy: [{ edition: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * 12,
        take: 12,
      }),
      this.prisma.dailyNote.count({ where }),
    ]);
    return { items, total, page: query.page };
  }
  @Get('admin/items')
  @UseGuards(AuthGuard, StaffMfaGuard)
  async admin(
    @CurrentUser() u: AccessTokenPayload,
    @Query(
      new ZodPipe(
        pageQuery.extend({ status: z.enum(['draft', 'published', 'hidden']).default('draft') }),
      ),
    )
    q: z.infer<typeof pageQuery> & { status: string },
  ) {
    editor(u);
    const where = { status: q.status };
    return {
      items: await this.prisma.dailyNote.findMany({
        where,
        select: noteSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * 12,
        take: 12,
      }),
      total: await this.prisma.dailyNote.count({ where }),
    };
  }
  @Get('admin/:id/cover')
  @UseGuards(AuthGuard, StaffMfaGuard)
  async preview(
    @CurrentUser() u: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    editor(u);
    return this.image(id, res, false);
  }
  @Patch('admin/:id')
  @UseGuards(AuthGuard, StaffMfaGuard)
  async review(
    @CurrentUser() u: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reviewInput)) input: z.infer<typeof reviewInput>,
  ) {
    editor(u);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.dailyNote.findUnique({ where: { id } });
      if (!row) throw new NotFoundException();
      const changed = await tx.dailyNote.updateMany({
        where: { id, updatedAt: new Date(input.updatedAt) },
        data: {
          status: input.status,
          publishedAt:
            input.status === 'published' ? (row.publishedAt ?? new Date()) : row.publishedAt,
        },
      });
      if (!changed.count) throw new ConflictException('Note changed; reload before reviewing');
      await tx.auditLog.create({
        data: { actorId: u.sub, action: `daily-note.${input.status}`, subject: id },
      });
      return tx.dailyNote.findUniqueOrThrow({ where: { id }, select: noteSelect });
    });
  }
  @Get(':id/cover')
  async cover(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    return this.image(id, res, true);
  }
  private async image(id: string, res: Response, published: boolean) {
    const row = await this.prisma.dailyNote.findFirst({
      where: { id, ...(published ? { status: 'published' } : {}) },
      select: { cover: true },
    });
    if (!row) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('image/webp').send(Buffer.from(row.cover));
  }
  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const row = await this.prisma.dailyNote.findFirst({
      where: { id, status: 'published' },
      select: noteSelect,
    });
    if (!row) throw new NotFoundException();
    return row;
  }
}
