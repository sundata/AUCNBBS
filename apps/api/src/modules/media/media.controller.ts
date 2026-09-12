import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type { Response } from 'express';
import { isPubliclyVisible } from '@aucn/domain';
import { AuthGuard, OptionalAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AccessTokenPayload } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
@Controller({ path: 'media', version: '1' })
export class MediaController {
  constructor(private readonly prisma: PrismaService) {}
  private root() {
    return resolve(process.env.MEDIA_LOCAL_DIR ?? './uploads');
  }
  private s3() {
    return new S3Client({ region: process.env.S3_REGION ?? 'ap-southeast-2' });
  }
  private async listing(id: string, user?: AccessTokenPayload, write = false) {
    const row = await this.prisma.listing.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    if (
      write &&
      (row.ownerId !== user?.sub ||
        ['removed', 'archived', 'completed', 'pending_review'].includes(row.status))
    )
      throw new ForbiddenException();
    if (!write && row.ownerId !== user?.sub && !isPubliclyVisible(row.status, row.expiresAt))
      throw new NotFoundException();
    return row;
  }
  @Get('listings/:id')
  @UseGuards(OptionalAuthGuard)
  async list(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AccessTokenPayload) {
    await this.listing(id, user);
    return this.prisma.media.findMany({
      where: { listingId: id },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
  @Post('listings/:id')
  @UseGuards(AuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024, files: 1 } }))
  async upload(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.listing(id, user, true);
    if (!file) throw new UnprocessableEntityException('Choose a JPEG, PNG or WebP image');
    let encoded: Buffer;
    try {
      const decoder = sharp(file.buffer, { limitInputPixels: 25_000_000, animated: false });
      const metadata = await decoder.metadata();
      if (
        !metadata.format ||
        !['jpeg', 'png', 'webp'].includes(metadata.format) ||
        (metadata.pages ?? 1) > 1
      )
        throw new Error('unsupported');
      encoded = await decoder
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new UnprocessableEntityException('Invalid image; JPEG, PNG or WebP required');
    }
    const key = `${randomUUID()}.webp`;
    if (process.env.S3_BUCKET)
      await this.s3().send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: key,
          Body: encoded,
          ContentType: 'image/webp',
        }),
      );
    else {
      await mkdir(this.root(), { recursive: true });
      await writeFile(resolve(this.root(), key), encoded, { flag: 'wx' });
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Lock the parent to serialize per-listing image limits and moderation changes.
        const rows = await tx.$queryRaw<
          { owner_id: string; status: string }[]
        >`SELECT owner_id, status FROM listings WHERE id = ${id}::uuid FOR UPDATE`;
        if (
          rows[0]?.owner_id !== user.sub ||
          ['removed', 'archived', 'completed', 'pending_review'].includes(rows[0]?.status)
        )
          throw new ForbiddenException();
        if ((await tx.media.count({ where: { listingId: id } })) >= 8)
          throw new UnprocessableEntityException('Maximum 8 images');
        return tx.media.create({
          data: { ownerId: user.sub, listingId: id, key, bytes: encoded.length },
          select: { id: true },
        });
      });
    } catch (e) {
      await this.removeBlob(key);
      throw e;
    }
  }
  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
    @CurrentUser() user?: AccessTokenPayload,
  ) {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media || !media.listingId) throw new NotFoundException();
    await this.listing(media.listingId, user);
    const bytes = process.env.S3_BUCKET
      ? Buffer.from(
          await (
            await this.s3().send(
              new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: media.key }),
            )
          ).Body!.transformToByteArray(),
        )
      : await readFile(resolve(this.root(), media.key));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('image/webp').send(bytes);
  }
  private async removeBlob(key: string) {
    if (process.env.S3_BUCKET)
      await this.s3().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    else
      await unlink(resolve(this.root(), key)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
  }
  @Delete(':id')
  @UseGuards(AuthGuard)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AccessTokenPayload) {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media || media.ownerId !== user.sub) throw new NotFoundException();
    if (media.listingId) await this.listing(media.listingId, user, true);
    await this.prisma.media.delete({ where: { id } });
    await this.removeBlob(media.key);
    return { ok: true };
  }
}
