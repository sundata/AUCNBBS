import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  acceptAnswerSchema,
  createCommentSchema,
  createPostSchema,
  updateCommentSchema,
  updatePostSchema,
  votePollSchema,
} from '@aucn/domain';
import { z } from 'zod';
import { cursorQuerySchema, Page } from '../../common/pagination';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthGuard, OptionalAuthGuard } from '../auth/auth.guard';
import { AccessTokenPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  BoardDto,
  CommentDto,
  CommunityService,
  PollDto,
  PostDetailDto,
  PostSummaryDto,
} from './community.service';

const postsQuerySchema = cursorQuerySchema.extend({
  board: z.string().optional(),
  cityId: z.string().uuid().optional(),
});

const STAFF_ROLES = ['moderator', 'admin', 'super_admin'];
const isStaff = (user: AccessTokenPayload) => STAFF_ROLES.includes(user.role);

@ApiTags('community')
@Controller({ path: 'community', version: '1' })
export class CommunityController {
  constructor(private readonly community: CommunityService) {}

  @Get('boards')
  boards(): Promise<BoardDto[]> {
    return this.community.boards();
  }

  @Get('posts')
  posts(
    @Query(new ZodPipe(postsQuerySchema)) query: z.infer<typeof postsQuerySchema>,
  ): Promise<Page<PostSummaryDto>> {
    return this.community.posts(query);
  }

  @Get('posts/:id')
  @UseGuards(OptionalAuthGuard)
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: AccessTokenPayload,
  ): Promise<PostDetailDto> {
    return this.community.post(id, user?.sub);
  }

  @Post('posts')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  createPost(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(createPostSchema)) body: z.infer<typeof createPostSchema>,
  ): Promise<PostDetailDto> {
    return this.community.createPost(user.sub, body);
  }

  @Patch('posts/:id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  updatePost(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updatePostSchema)) body: z.infer<typeof updatePostSchema>,
  ): Promise<PostDetailDto> {
    return this.community.updatePost(user.sub, id, body, isStaff(user));
  }

  @Delete('posts/:id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async deletePost(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.community.deletePost(user.sub, id, isStaff(user));
    return { ok: true };
  }

  @Get('posts/:id/revisions')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  postRevisions(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.community.revisions(user.sub, 'post', id, isStaff(user));
  }

  @Post('posts/:id/vote')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  vote(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(votePollSchema)) body: z.infer<typeof votePollSchema>,
  ): Promise<PollDto> {
    return this.community.votePoll(user.sub, id, body.optionIds);
  }

  @Post('posts/:id/accept')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async accept(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(acceptAnswerSchema)) body: z.infer<typeof acceptAnswerSchema>,
  ) {
    await this.community.acceptAnswer(user.sub, id, body.commentId);
    return { ok: true };
  }

  @Delete('posts/:id/accept')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async unaccept(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.community.acceptAnswer(user.sub, id, null);
    return { ok: true };
  }

  @Post('posts/:id/comments')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  createComment(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(createCommentSchema)) body: z.infer<typeof createCommentSchema>,
  ): Promise<CommentDto> {
    return this.community.createComment(user.sub, id, body);
  }

  @Patch('comments/:id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async updateComment(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateCommentSchema)) body: z.infer<typeof updateCommentSchema>,
  ) {
    await this.community.updateComment(user.sub, id, body, isStaff(user));
    return { ok: true };
  }

  @Delete('comments/:id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async deleteComment(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.community.deleteComment(user.sub, id, isStaff(user));
    return { ok: true };
  }
}
