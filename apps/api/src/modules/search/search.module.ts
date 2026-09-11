import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { PostgresSearchProvider } from './postgres-search.provider';
import { SEARCH_PROVIDER } from './search.provider';

@Module({
  controllers: [SearchController],
  providers: [{ provide: SEARCH_PROVIDER, useClass: PostgresSearchProvider }],
  exports: [SEARCH_PROVIDER],
})
export class SearchModule {}
