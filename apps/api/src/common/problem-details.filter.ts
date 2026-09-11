import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  errors?: unknown;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let problem: ProblemDetails;
    if (exception instanceof ZodError) {
      problem = {
        type: 'https://aucnhub.local/problems/validation',
        title: 'Validation failed',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        instance: req.url,
        errors: exception.flatten(),
      };
    } else if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const detail =
        typeof body === 'string' ? body : (body as { message?: string | string[] }).message;
      problem = {
        type: `https://aucnhub.local/problems/${exception.getStatus()}`,
        title: exception.message,
        status: exception.getStatus(),
        detail: Array.isArray(detail) ? detail.join('; ') : detail,
        instance: req.url,
      };
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      problem = {
        type: 'https://aucnhub.local/problems/internal',
        title: 'Internal Server Error',
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        instance: req.url,
      };
    }
    res.status(problem.status).type('application/problem+json').json(problem);
  }
}
