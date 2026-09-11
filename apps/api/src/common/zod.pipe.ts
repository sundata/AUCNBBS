import { Injectable, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

@Injectable()
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    return this.schema.parse(value);
  }
}
