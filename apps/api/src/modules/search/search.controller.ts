import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LISTING_TYPES } from '@aucn/domain';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { SEARCH_PROVIDER, SearchProvider, SearchResult } from './search.provider';

const searchQuerySchema = z.object({
  q: z.string().min(1).max(120),
  scope: z.enum(['all', 'listings', 'posts', 'articles', 'businesses', 'events']).default('all'),
  cityId: z.string().uuid().optional(),
  type: z.enum(LISTING_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

@ApiTags('search')
@Controller({ path: 'search', version: '1' })
export class SearchController {
  constructor(@Inject(SEARCH_PROVIDER) private readonly provider: SearchProvider) {}

  @Get()
  search(
    @Query(new ZodPipe(searchQuerySchema)) query: z.infer<typeof searchQuerySchema>,
  ): Promise<SearchResult> {
    return this.provider.search(query);
  }
}
