import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthSessionService, authUnauthorized } from './auth-session.service';

jest.mock('../storage/r2-upload', () => ({}));

describe('Refresh/logout rate limits and safe errors', () => {
    let app: INestApplication;
    const sessions = { refresh: jest.fn(), logout: jest.fn() };
    beforeEach(async () => {
        jest.clearAllMocks();
        sessions.refresh.mockRejectedValue(authUnauthorized('REFRESH_TOKEN_INVALID'));
        sessions.logout.mockResolvedValue(undefined);
        const module = await Test.createTestingModule({
            imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 120 }])],
            controllers: [AuthController],
            providers: [
                { provide: AuthService, useValue: {} },
                { provide: AuthSessionService, useValue: sessions },
                { provide: APP_GUARD, useClass: ThrottlerGuard },
            ],
        }).compile();
        app = module.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
        await app.init();
    });
    afterEach(async () => { await app.close(); });

    it.each(['/auth/refresh', '/auth/logout'])('limits %s to twenty requests per minute with coded 429', async path => {
        for (let index = 0; index < 20; index++) {
            await request(app.getHttpServer()).post(path).send({ refreshToken: 'a'.repeat(43) }).expect(path.endsWith('refresh') ? 401 : 204);
        }
        const response = await request(app.getHttpServer()).post(path).send({ refreshToken: 'a'.repeat(43) }).expect(429);
        expect(response.body.code).toBe('RATE_LIMITED');
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['retry-after']).toBeDefined();
    });
});
