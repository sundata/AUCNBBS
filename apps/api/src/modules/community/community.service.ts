import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateCommentInput, CreatePostInput } from '@aucn/domain';
import type { Prisma } from '@prisma/client';
import { CursorQuery, decodeCursor, Page, toPage } from '../../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

export interface BoardDto {
  id: string;
  slug: string;
  nameZh: string;
  nameEn: string;
  descriptionZh: string;
  descriptionEn: string;
  postCount: number;
}

export interface AuthorDto {
  id: string | null;
  displayName: string;
}

export interface PostSummaryDto {
  id: string;
  boardSlug: string;
  type: string;
  title: string;
  anonymous: boolean;
  author: AuthorDto;
  city: { id: string; slug: string; nameZh: string; nameEn: string } | null;
  commentCount: number;
  viewCount: number;
  pinned: boolean;
  lastActiveAt: string;
  createdAt: Date;
}

export interface PostDetailDto extends PostSummaryDto {
  body: string;
  comments: CommentDto[];
}

export interface CommentDto {
  id: string;
  parentId: string | null;
  body: string;
  author: AuthorDto;
  createdAt: string;
}

const postInclude = {
  board: { select: { slug: true } },
  author: { select: { id: true, displayName: true } },
  city: { select: { id: true, slug: true, nameZh: true, nameEn: true } },
} satisfies Prisma.PostInclude;

type PostRow = Prisma.PostGetPayload<{ include: typeof postInclude }>;

function author(row: {
  author: { id: string; displayName: string };
  anonymous: boolean;
}): AuthorDto {
  return row.anonymous ? { id: null, displayName: '匿名用户' } : row.author;
}

function toSummary(p: PostRow): PostSummaryDto {
  return {
    id: p.id,
    boardSlug: p.board.slug,
    type: p.type,
    title: p.title,
    anonymous: p.anonymous,
    author: author(p),
    city: p.city,
    commentCount: p.commentCount,
    viewCount: p.viewCount,
    pinned: p.pinned,
    lastActiveAt: p.lastActiveAt.toISOString(),
    createdAt: p.createdAt,
  };
}

@Injectable()
export class CommunityService {
  constructor(private readonly prisma: PrismaService) {}

  async boards(): Promise<BoardDto[]> {
    const rows = await this.prisma.board.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { posts: { where: { status: 'published' } } } } },
    });
    return rows.map((b) => ({
      id: b.id,
      slug: b.slug,
      nameZh: b.nameZh,
      nameEn: b.nameEn,
      descriptionZh: b.descriptionZh,
      descriptionEn: b.descriptionEn,
      postCount: b._count.posts,
    }));
  }

  async posts(
    query: CursorQuery & { board?: string; cityId?: string },
  ): Promise<Page<PostSummaryDto>> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.post.findMany({
      where: {
        status: 'published',
        ...(query.board ? { board: { slug: query.board } } : {}),
        ...(query.cityId ? { cityId: query.cityId } : {}),
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
      include: postInclude,
    });
    return toPage(rows.map(toSummary), query.limit);
  }

  async post(id: string): Promise<PostDetailDto> {
    const p = await this.prisma.post.findFirst({
      where: { id, status: 'published' },
      include: {
        ...postInclude,
        comments: {
          where: { status: 'published' },
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, displayName: true } } },
        },
      },
    });
    if (!p) throw new NotFoundException('Post not found');
    await this.prisma.post.update({ where: { id }, data: { viewCount: { increment: 1 } } });
    return {
      ...toSummary(p),
      body: p.body,
      comments: p.comments.map((c) => ({
        id: c.id,
        parentId: c.parentId,
        body: c.body,
        author: c.author,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  async createPost(userId: string, input: CreatePostInput): Promise<PostDetailDto> {
    const board = await this.prisma.board.findUnique({ where: { slug: input.boardSlug } });
    if (!board) throw new NotFoundException('Board not found');
    const created = await this.prisma.post.create({
      data: {
        boardId: board.id,
        authorId: userId,
        cityId: input.cityId,
        type: input.type,
        title: input.title,
        body: input.body,
        anonymous: input.anonymous,
      },
    });
    return this.post(created.id);
  }

  async createComment(
    userId: string,
    postId: string,
    input: CreateCommentInput,
  ): Promise<CommentDto> {
    const post = await this.prisma.post.findFirst({ where: { id: postId, status: 'published' } });
    if (!post) throw new NotFoundException('Post not found');
    let depth = 0;
    if (input.parentId) {
      const parent = await this.prisma.comment.findFirst({ where: { id: input.parentId, postId } });
      if (!parent) throw new NotFoundException('Parent comment not found');
      depth = parent.depth + 1;
      if (depth > 1) throw new ForbiddenException('Nested replies are limited to one level');
    }
    const [comment] = await this.prisma.$transaction([
      this.prisma.comment.create({
        data: { postId, authorId: userId, parentId: input.parentId, body: input.body, depth },
        include: { author: { select: { id: true, displayName: true } } },
      }),
      this.prisma.post.update({
        where: { id: postId },
        data: { commentCount: { increment: 1 }, lastActiveAt: new Date() },
      }),
    ]);
    return {
      id: comment.id,
      parentId: comment.parentId,
      body: comment.body,
      author: comment.author,
      createdAt: comment.createdAt.toISOString(),
    };
  }
}
