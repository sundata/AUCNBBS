import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createListingSchema,
  LISTING_INTENTS,
  LISTING_STATUSES,
  LISTING_TYPES,
} from '@aucn/domain';
import { z } from 'zod';
import { cursorQuerySchema, Page } from '../../common/pagination';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthGuard, OptionalAuthGuard } from '../auth/auth.guard';
import { AccessTokenPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { ListingDetailDto, ListingsService, ListingSummaryDto } from './listings.service';

const listQuerySchema = cursorQuerySchema.extend({
  type: z.enum(LISTING_TYPES).optional(),
  intent: z.enum(LISTING_INTENTS).optional(),
  cityId: z.string().uuid().optional(),
  priceMin: z.coerce.number().int().nonnegative().optional(),
  priceMax: z.coerce.number().int().nonnegative().optional(),
});
const editSchema = z.object({ version: z.number().int().positive(), listing: createListingSchema });
const statusSchema = z.object({ status: z.enum(LISTING_STATUSES) });

@ApiTags('listings')
@Controller({ path: 'listings', version: '1' })
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get()
  list(
    @Query(new ZodPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ): Promise<Page<ListingSummaryDto>> {
    return this.listings.list(query);
  }

  @Get('mine')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  mine(
    @CurrentUser() user: AccessTokenPayload,
    @Query(new ZodPipe(cursorQuerySchema)) query: z.infer<typeof cursorQuerySchema>,
  ): Promise<Page<ListingSummaryDto>> {
    return this.listings.mine(user.sub, query);
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: AccessTokenPayload,
  ): Promise<ListingDetailDto> {
    return this.listings.get(id, user?.sub);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(createListingSchema)) body: z.infer<typeof createListingSchema>,
  ): Promise<ListingDetailDto> {
    return this.listings.create(user.sub, body);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(editSchema)) body: z.infer<typeof editSchema>,
  ): Promise<ListingDetailDto> {
    return this.listings.update(user.sub, id, body.version, body.listing);
  }

  @Post(':id/status')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  changeStatus(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(statusSchema)) body: z.infer<typeof statusSchema>,
  ): Promise<ListingDetailDto> {
    return this.listings.changeStatus(user.sub, id, body.status);
  }
}
