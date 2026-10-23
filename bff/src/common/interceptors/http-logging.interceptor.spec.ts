import { ExecutionContext, Logger, UnauthorizedException } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { HttpLoggingInterceptor } from './http-logging.interceptor';

describe('HTTP logging privacy', () => {
    it.each([false, true])('omits query tokens, credentials, bodies and exception messages (error=%s)', async fail => {
        const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        const context = {
            switchToHttp: () => ({
                getRequest: () => ({ method: 'POST', originalUrl: '/auth/google?token=query-secret', headers: { authorization: 'Bearer bearer-secret' }, body: { idToken: 'id-secret', password: 'password-secret' } }),
                getResponse: () => ({ statusCode: 200 }),
            }),
        } as unknown as ExecutionContext;
        const failure = new UnauthorizedException('exception-secret');
        try {
            const result = firstValueFrom(new HttpLoggingInterceptor().intercept(context, {
                handle: () => fail ? throwError(() => failure) : of({ refreshToken: 'response-secret' }),
            }));
            if (fail) await expect(result).rejects.toBe(failure);
            else await result;
            const output = JSON.stringify([...log.mock.calls, ...warn.mock.calls]);
            expect(output).toContain('POST /auth/google ->');
            expect(output).not.toContain('secret');
        } finally { log.mockRestore(); warn.mockRestore(); }
    });
});
