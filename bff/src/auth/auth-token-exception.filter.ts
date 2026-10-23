import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';

// Stable machine-readable errors for the two new endpoints only. Never echo
// submitted tokens, validator values or infrastructure error details.
@Catch(HttpException)
export class AuthTokenExceptionFilter implements ExceptionFilter {
    catch(exception: HttpException, host: ArgumentsHost) {
        const statusCode = exception.getStatus();
        const body = exception.getResponse();
        const allowed = ['REFRESH_TOKEN_INVALID', 'REFRESH_TOKEN_REUSED', 'AUTH_TEMPORARILY_UNAVAILABLE'];
        const candidate = typeof body === 'object' && body !== null && 'code' in body ? String(body.code) : '';
        const code = allowed.includes(candidate) ? candidate : statusCode === 400 ? 'VALIDATION_ERROR' : statusCode === 429 ? 'RATE_LIMITED' : 'AUTH_TEMPORARILY_UNAVAILABLE';
        host.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store').status(statusCode).json({ statusCode, code, message: statusCode === 400 ? 'Invalid request.' : 'Authentication request could not be completed.' });
    }
}
