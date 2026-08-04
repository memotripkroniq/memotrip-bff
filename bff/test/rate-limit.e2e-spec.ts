import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { App } from 'supertest/types';
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
const request = require('supertest');

@Controller()
class HealthcheckController {
    @SkipThrottle()
    @Get()
    getHello() {
        return 'Hello World!';
    }
}

@Controller('auth')
class TestAuthController {
    @Post('login')
    @Throttle({ default: { limit: 5, ttl: 60_000 } })
    async login(@Body() body: { email: string; password: string }) {
        return { ok: true, email: body.email, password: body.password };
    }
}

class TestJwtAuthGuard implements CanActivate {
    canActivate(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest();
        req.user = { sub: 'test-user' };
        return true;
    }
}

@Controller('trips')
class TestTripsController {
    @UseGuards(TestJwtAuthGuard)
    @Post('generate-map')
    @Throttle({ default: { limit: 10, ttl: 600_000 } })
    async generateMap() {
        return { ok: true };
    }

    @UseGuards(TestJwtAuthGuard)
    @Post('render-map')
    @Throttle({ default: { limit: 5, ttl: 600_000 } })
    async renderMap() {
        return { ok: true };
    }
}

describe('Rate limiting (e2e)', () => {
    let app: INestApplication<App>;

    beforeEach(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                ThrottlerModule.forRoot([
                    {
                        name: 'default',
                        ttl: 60_000,
                        limit: 120,
                    },
                ]),
            ],
            controllers: [HealthcheckController, TestAuthController, TestTripsController],
            providers: [
                TestJwtAuthGuard,
                {
                    provide: APP_GUARD,
                    useClass: ThrottlerGuard,
                },
            ],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.set('trust proxy', 1);
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    it('GET / is excluded from throttling', async () => {
        for (let i = 0; i < 130; i++) {
            await request(app.getHttpServer())
                .get('/')
                .expect(200)
                .expect('Hello World!');
        }
    });

    it('returns 429 after exceeding the /auth/login limit', async () => {
        for (let i = 0; i < 5; i++) {
            await request(app.getHttpServer())
                .post('/auth/login')
                .send({ email: 'user@example.com', password: 'secret' })
                .expect(201);
        }

        await request(app.getHttpServer())
            .post('/auth/login')
            .send({ email: 'user@example.com', password: 'secret' })
            .expect(429);
    });

    it('returns 429 after exceeding the /trips/generate-map limit', async () => {
        for (let i = 0; i < 10; i++) {
            await request(app.getHttpServer())
                .post('/trips/generate-map')
                .send({})
                .expect(201);
        }

        await request(app.getHttpServer())
            .post('/trips/generate-map')
            .send({})
            .expect(429);
    });

    it('returns 429 after exceeding the /trips/render-map limit', async () => {
        for (let i = 0; i < 5; i++) {
            await request(app.getHttpServer())
                .post('/trips/render-map')
                .send({})
                .expect(201);
        }

        await request(app.getHttpServer())
            .post('/trips/render-map')
            .send({})
            .expect(429);
    });
});
