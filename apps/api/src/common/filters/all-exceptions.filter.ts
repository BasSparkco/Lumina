import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = exception instanceof HttpException ? (exception.getResponse() as { message?: string; code?: string }) : undefined;
    const message = body?.message ?? (exception instanceof HttpException ? exception.message : 'Internal server error');
    // Only populated for the handful of "your session is no longer valid" exceptions that
    // attach one (see AuthErrorCode) — undefined here for every other exception in the app,
    // and JSON.stringify/res.json() drop undefined keys, so this changes no existing response.
    const code = body?.code;

    if (status >= 500) this.logger.error(exception);

    res.status(status).json({ statusCode: status, message, code, timestamp: new Date().toISOString() });
  }
}
