import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

export interface CityDto {
  id: string;
  slug: string;
  state: string;
  nameZh: string;
  nameEn: string;
  timezone: string;
  isLaunch: boolean;
}

@ApiTags('regions')
@Controller({ path: 'cities', version: '1' })
export class RegionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(): Promise<CityDto[]> {
    const rows = await this.prisma.city.findMany({ orderBy: { sortOrder: 'asc' } });
    return rows.map(({ id, slug, state, nameZh, nameEn, timezone, isLaunch }) => ({
      id,
      slug,
      state,
      nameZh,
      nameEn,
      timezone,
      isLaunch,
    }));
  }
}
