import {
    CallHandler,
    ExecutionContext,
    HttpException,
    Injectable,
    Logger,
    NestInterceptor,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
    private readonly logger = new Logger(HttpLoggingInterceptor.name);

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const http = context.switchToHttp();
        const request = http.getRequest();
        const response = http.getResponse();
        const method = request.method;
        const path = this.getSafePath(request.originalUrl ?? request.url ?? '/');
        const startedAt = Date.now();
        let logged = false;

        const logRequest = (statusCode: number) => {
            if (logged) {
                return;
            }

            logged = true;
            const durationMs = Date.now() - startedAt;
            const message = `HTTP ${method} ${path} -> ${statusCode} (${durationMs} ms)`;

            if (statusCode >= 500) {
                this.logger.error(message);
                return;
            }

            if (statusCode >= 400) {
                this.logger.warn(message);
                return;
            }

            this.logger.log(message);
        };

        return next.handle().pipe(
            tap(() => {
                logRequest(response.statusCode);
            }),
            catchError((error: unknown) => {
                const statusCode = error instanceof HttpException
                    ? error.getStatus()
                    : 500;
                logRequest(statusCode);
                return throwError(() => error);
            }),
        );
    }

    private getSafePath(url: string) {
        const [path] = url.split('?');
        return path || '/';
    }
}
