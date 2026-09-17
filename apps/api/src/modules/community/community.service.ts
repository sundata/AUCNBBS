import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  CreateCommentInput,
  CreatePostInput,
  UpdateCommentInput,
  UpdatePostInput,
} from '@aucn/domain';
import type { Prisma } from '@prisma/client';
import { CursorQuery, decodeCursor, Page, toPage } from '../../common/pagination';
import { notify } from '../../common/notify';
import { outbox } from '../../common/outbox';
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
  displayName: string | null;
  anonymous: boolean;
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
  locked: boolean;
  edited: boolean;
  hasPoll: boolean;
  lastActiveAt: string;
  createdAt: Date;
}

export interface PollOptionDto {
  id: string;
  label: string;
  votes: number;
}

export interface PollDto {
  multi: boolean;
  closesAt: string | null;
  closed: boolean;
  totalVotes: number;
  myOptionIds: string[];
  options: PollOptionDto[];
}

export interface PostDetailDto extends PostSummaryDto {
  body: string;
  slowmodeSec: number;
  acceptedCommentId: string | null;
  viewerIsAuthor: boolean;
  poll: PollDto | null;
  comments: CommentDto[];
}

export interface CommentDto {
  id: string;
  parentId: string | null;
  body: string;
  author: AuthorDto;
  edited: boolean;
  accepted: boolean;
  createdAt: string;
}

const postInclude = {
  board: { select: { slug: true } },
  author: { select: { id: true, displayName: true } },
  city: { select: { id: true, slug: true, nameZh: true, nameEn: true } },
} satisfies Prisma.PostInclude;

type PostRow = Prisma.PostGetPayload<{ include: typeof postInclude }>;

/** W-5: anonymous posts return a flag; the client renders the localised name. */
function author(row: {
  author: { id: string; displayName: string };
  anonymous: boolean;
}): AuthorDto {
  return row.anonymous
    ? { id: null, displayName: null, anonymous: true }
    : { ...row.author, anonymous: false };
}

const EDITED_GRACE_MS = 5_000;

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
    locked: p.locked,
    edited: p.updatedAt.getTime() - p.createdAt.getTime() > EDITED_GRACE_MS,
    hasPoll: p.type === 'poll',
    lastActiveAt: p.lastActiveAt.toISOString(),
    createdAt: p.createdAt,
  };
}

@Injectable()
export class CommunityService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertNotMuted(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mutedUntil: true, status: true },
    });
    if (user?.mutedUntil && user.mutedUntil > new Date())
      throw new ForbiddenException(`Muted until ${user.mutedUntil.toISOString()}`);
    if (user?.status !== 'active') throw new ForbiddenException('Account unavailable');
  }

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
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: postInclude,
    });
    return toPage(rows.map(toSummary), query.limit);
  }

  async post(id: string, viewerId?: string): Promise<PostDetailDto> {
    const p = await this.prisma.post.findFirst({
      where: { id, status: 'published' },
      include: {
        ...postInclude,
        poll: { include: { options: { orderBy: { position: 'asc' }, include: { votes: true } } } },
        comments: {
          where: { status: 'published' },
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, displayName: true } } },
        },
      },
    });
    if (!p) throw new NotFoundException('Post not found');
    await this.prisma.post.update({ where: { id }, data: { viewCount: { increment: 1 } } });
    const poll = p.poll
      ? {
          multi: p.poll.multi,
          closesAt: p.poll.closesAt?.toISOString() ?? null,
          closed: !!p.poll.closesAt && p.poll.closesAt <= new Date(),
          totalVotes: p.poll.options.reduce((n, o) => n + o.votes.length, 0),
          myOptionIds: viewerId
            ? p.poll.options.flatMap((o) =>
                o.votes.filter((v) => v.userId === viewerId).map(() => o.id),
              )
            : [],
          options: p.poll.options.map((o) => ({ id: o.id, label: o.label, votes: o.votes.length })),
        }
      : null;
    return {
      ...toSummary(p),
      body: p.body,
      slowmodeSec: p.slowmodeSec,
      acceptedCommentId: p.acceptedCommentId,
      viewerIsAuthor: !!viewerId && p.authorId === viewerId,
      poll,
      comments: p.comments.map((c) => ({
        id: c.id,
        parentId: c.parentId,
        body: c.body,
        author: { ...c.author, anonymous: false },
        edited: c.updatedAt.getTime() - c.createdAt.getTime() > EDITED_GRACE_MS,
        accepted: p.acceptedCommentId === c.id,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  async createPost(userId: string, input: CreatePostInput): Promise<PostDetailDto> {
    await this.assertNotMuted(userId);
    const board = await this.prisma.board.findUnique({ where: { slug: input.boardSlug } });
    if (!board) throw new NotFoundException('Board not found');
    const created = await this.prisma.$transaction(async (tx) => {
      const post = await tx.post.create({
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
      if (input.type === 'poll' && input.poll) {
        await tx.poll.create({
          data: {
            postId: post.id,
            multi: input.poll.multi,
            closesAt: input.poll.closesAt ? new Date(input.poll.closesAt) : null,
            options: {
              create: input.poll.options.map((label, i) => ({ label, position: i })),
            },
          },
        });
      }
      await outbox(tx, `post:${post.id}`, 'post.created', {
        postId: post.id,
        authorId: userId,
        boardSlug: board.slug,
        type: input.type,
      });
      return post;
    });
    return this.post(created.id, userId);
  }

  async updatePost(
    userId: string,
    postId: string,
    input: UpdatePostInput,
    isStaff: boolean,
  ): Promise<PostDetailDto> {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.status !== 'published') throw new NotFoundException('Post not found');
    if (post.authorId !== userId && !isStaff) throw new ForbiddenException('Not the author');
    if (post.locked && !isStaff) throw new ForbiddenException('Post is locked');
    if (input.title === undefined && input.body === undefined) return this.post(postId, userId);
    await this.prisma.$transaction(async (tx) => {
      // Keep the previous version for audit (§5.4 编辑历史可审计).
      await tx.contentRevision.create({
        data: {
          subjectType: 'post',
          subjectId: postId,
          editorId: userId,
          title: post.title,
          body: post.body,
        },
      });
      await tx.post.update({
        where: { id: postId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
        },
      });
    });
    return this.post(postId, userId);
  }

  async revisions(
    userId: string,
    subjectType: 'post' | 'comment' | 'article',
    subjectId: string,
    isStaff: boolean,
  ) {
    if (subjectType === 'post') {
      const post = await this.prisma.post.findUnique({ where: { id: subjectId } });
      if (!post) throw new NotFoundException();
      if (post.authorId !== userId && !isStaff) throw new ForbiddenException();
    }
    return this.prisma.contentRevision.findMany({
      where: { subjectType, subjectId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, editorId: true, title: true, body: true, createdAt: true },
    });
  }

  async createComment(
    userId: string,
    postId: string,
    input: CreateCommentInput,
  ): Promise<CommentDto> {
    await this.assertNotMuted(userId);
    const post = await this.prisma.post.findFirst({ where: { id: postId, status: 'published' } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.locked) throw new ForbiddenException('Post is locked');
    if (post.slowmodeSec > 0) {
      const last = await this.prisma.comment.findFirst({
        where: { postId, authorId: userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (last && Date.now() - last.createdAt.getTime() < post.slowmodeSec * 1000)
        throw new ForbiddenException(`Slow mode: wait ${post.slowmodeSec}s between comments`);
    }
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
    if (post.authorId !== userId) {
      await notify(this.prisma, post.authorId, 'reply', postId, { commentId: comment.id });
    }
    return {
      id: comment.id,
      parentId: comment.parentId,
      body: comment.body,
      author: { ...comment.author, anonymous: false },
      edited: false,
      accepted: false,
      createdAt: comment.createdAt.toISOString(),
    };
  }

  async updateComment(
    userId: string,
    commentId: string,
    input: UpdateCommentInput,
    isStaff: boolean,
  ): Promise<void> {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.status !== 'published') throw new NotFoundException();
    if (comment.authorId !== userId && !isStaff) throw new ForbiddenException('Not the author');
    await this.prisma.$transaction([
      this.prisma.contentRevision.create({
        data: {
          subjectType: 'comment',
          subjectId: commentId,
          editorId: userId,
          body: comment.body,
        },
      }),
      this.prisma.comment.update({ where: { id: commentId }, data: { body: input.body } }),
    ]);
  }

  async deleteComment(userId: string, commentId: string, isStaff: boolean): Promise<void> {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.status !== 'published') throw new NotFoundException();
    if (comment.authorId !== userId && !isStaff) throw new ForbiddenException('Not the author');
    await this.prisma.comment.update({ where: { id: commentId }, data: { status: 'removed' } });
  }

  async deletePost(userId: string, postId: string, isStaff: boolean): Promise<void> {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.status !== 'published') throw new NotFoundException();
    if (post.authorId !== userId && !isStaff) throw new ForbiddenException('Not the author');
    await this.prisma.post.update({ where: { id: postId }, data: { status: 'removed' } });
    await this.prisma.auditLog.create({
      data: { actorId: userId, action: 'post.delete', subject: `post:${postId}` },
    });
  }

  // ---------- Polls ----------

  async votePoll(userId: string, postId: string, optionIds: string[]): Promise<PollDto> {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, status: 'published', type: 'poll' },
      include: { poll: { include: { options: true } } },
    });
    if (!post?.poll) throw new NotFoundException('Poll not found');
    if (post.poll.closesAt && post.poll.closesAt <= new Date())
      throw new ForbiddenException('Poll is closed');
    const valid = new Set(post.poll.options.map((o) => o.id));
    if (optionIds.some((id) => !valid.has(id)))
      throw new UnprocessableEntityException('Bad option');
    if (!post.poll.multi && optionIds.length > 1)
      throw new UnprocessableEntityException('Single-choice poll');
    await this.prisma.$transaction(async (tx) => {
      // Single-choice: replace the user's previous vote; multi: add the new selections.
      if (!post.poll!.multi) {
        await tx.pollVote.deleteMany({
          where: { userId, option: { pollId: post.poll!.id } },
        });
      }
      for (const optionId of optionIds) {
        await tx.pollVote.upsert({
          where: { optionId_userId: { optionId, userId } },
          update: {},
          create: { optionId, userId },
        });
      }
    });
    return (await this.post(postId, userId)).poll!;
  }

  // ---------- Q&A accepted answer ----------

  async acceptAnswer(userId: string, postId: string, commentId: string | null): Promise<void> {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, status: 'published', type: 'question' },
    });
    if (!post) throw new NotFoundException('Question not found');
    if (post.authorId !== userId) throw new ForbiddenException('Only the asker can accept');
    if (commentId) {
      const comment = await this.prisma.comment.findFirst({
        where: { id: commentId, postId, status: 'published' },
      });
      if (!comment) throw new NotFoundException('Comment not found');
    }
    await this.prisma.post.update({
      where: { id: postId },
      data: { acceptedCommentId: commentId },
    });
    if (commentId) {
      const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
      if (comment && comment.authorId !== userId) {
        await notify(this.prisma, comment.authorId, 'reply', postId, { accepted: true });
      }
    }
  }
}
