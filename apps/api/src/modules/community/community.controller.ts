import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createCommentSchema, createPostSchema } from '@aucn/domain';
import { z } from 'zod';
import { cursorQuerySchema, Page } from '../../common/pagination';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { AccessTokenPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  BoardDto,
  CommentDto,
  CommunityService,
  PostDetailDto,
  PostSummaryDto,
} from './community.service';

const postsQuerySchema = cursorQuerySchema.extend({
  board: z.string().optional(),
  cityId: z.string().uuid().optional(),
});

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
  post(@Param('id', ParseUUIDPipe) id: string): Promise<PostDetailDto> {
    return this.community.post(id);
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
}
