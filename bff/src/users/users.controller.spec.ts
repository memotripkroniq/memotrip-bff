import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { MODULE_METADATA } from '@nestjs/common/constants';
import request from 'supertest';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersModule } from './users.module';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

describe('Legacy UsersController authorization', () => {
    let app: INestApplication;
    const originalSecret = process.env.JWT_SECRET;
    const jwt = new JwtService({ secret: 'users-test-secret' });
    const safe = { id: '550e8400-e29b-41d4-a716-446655440001', email: 'a@example.com', name: 'A', country: 'EN' };
    const users = { findAll: jest.fn(), createUser: jest.fn(), validateUser: jest.fn() };
    const prisma = { user: { findFirst: jest.fn() } };
    beforeAll(async () => {
        process.env.JWT_SECRET = 'users-test-secret';
        const module = await Test.createTestingModule({
            controllers: [UsersController],
            providers: [JwtStrategy, { provide: UsersService, useValue: users }, { provide: PrismaService, useValue: prisma }],
        }).compile();
        app = module.createNestApplication();
        await app.init();
    });
    beforeEach(() => {
        jest.clearAllMocks();
        prisma.user.findFirst.mockResolvedValue({ id: safe.id });
        users.findAll.mockResolvedValue([safe]);
    });
    afterAll(async () => {
        await app.close();
        if (originalSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalSecret;
    });
    it('keeps the legacy controller unregistered in production configuration', () => {
        expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, UsersModule) ?? []).not.toContain(UsersController);
    });
    it('rejects anonymous, invalid and expired credentials before reading personal data', async () => {
        await request(app.getHttpServer()).get('/users').expect(401);
        for (const token of ['invalid', jwt.sign({ sub: safe.id }, { expiresIn: -1 })]) {
            await request(app.getHttpServer()).get('/users').auth(token, { type: 'bearer' }).expect(401);
        }
        expect(users.findAll).not.toHaveBeenCalled();
    });
    it('rejects a deleted or missing account', async () => {
        prisma.user.findFirst.mockResolvedValue(null);
        await request(app.getHttpServer()).get('/users').auth(jwt.sign({ sub: safe.id }, { expiresIn: '15m' }), { type: 'bearer' }).expect(401);
        expect(users.findAll).not.toHaveBeenCalled();
    });
    it('uses JWT identity rather than a requested foreign account', async () => {
        await request(app.getHttpServer()).get('/users?userId=user-b').auth(jwt.sign({ sub: safe.id }, { expiresIn: '15m' }), { type: 'bearer' }).expect(200, [safe]);
        expect(users.findAll).toHaveBeenCalledWith(safe.id);
    });
    it('preserves public create and login response envelopes', async () => {
        users.createUser.mockResolvedValue(safe);
        await request(app.getHttpServer()).post('/users').send({ email: safe.email, password: 'password123', name: 'A', country: 'EN' }).expect(201, safe);
        users.validateUser.mockResolvedValue(safe);
        await request(app.getHttpServer()).post('/users/login').send({ email: safe.email, password: 'password123' }).expect(201, { success: true, user: safe });
        users.validateUser.mockResolvedValue(null);
        await request(app.getHttpServer()).post('/users/login').send({ email: safe.email, password: 'wrong' }).expect(201, { success: false, message: 'Invalid email or password' });
    });
});
