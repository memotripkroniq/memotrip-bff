import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsModule } from './payments.module';

describe('DummyPay pending recovery and create guard', () => {
    const originalEnv = process.env;
    const owner = '550e8400-e29b-41d4-a716-446655440001';
    const foreign = '550e8400-e29b-41d4-a716-446655440002';
    const id = (n: number) => `550e8400-e29b-41d4-a716-${n.toString().padStart(12, '0')}`;
    const jwt = new JwtService({ secret: 'pending-tests-only' });
    const tx = { $queryRaw: jest.fn(), purchase: { findFirst: jest.fn(), create: jest.fn() } };
    const prisma = {
        user: { findFirst: jest.fn(), update: jest.fn() },
        purchase: { findMany: jest.fn() }, $transaction: jest.fn(),
    };
    let app: INestApplication;
    let bearer: string;
    let rows: any[];
    beforeAll(async () => {
        process.env = { ...originalEnv, JWT_SECRET: 'pending-tests-only' };
        const module = await Test.createTestingModule({
            imports: [PaymentsModule], providers: [JwtStrategy, { provide: PrismaService, useValue: prisma }],
        }).overrideProvider(PrismaService).useValue(prisma).compile();
        app = module.createNestApplication();
        app.useLogger(false);
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
        await app.init();
        bearer = jwt.sign({ sub: owner }, { expiresIn: '5m' });
    });
    beforeEach(() => {
        jest.resetAllMocks();
        process.env.NODE_ENV = 'development';
        process.env.PUBLIC_BASE_URL = 'https://test.invalid';
        rows = [5, 4, 3].map(n => ({
            id: id(n), userId: owner, provider: 'DUMMY_PAY', status: 'PENDING',
            plan: n === 4 ? 'PREMIUM' : 'KRONIQ', createdAt: new Date('2026-01-01Z'),
            accessTokenHash: 'private', paymentUrl: 'private', providerReference: 'private',
        }));
        rows.push({ ...rows[0], id: id(6), userId: foreign });
        rows.push({ ...rows[0], id: id(7), provider: 'GOOGLE_PLAY' });
        rows.push({ ...rows[0], id: id(8), status: 'COMPLETED' });
        prisma.user.findFirst.mockResolvedValue({ id: owner });
        prisma.purchase.findMany.mockImplementation(async ({ where, take }) => rows
            .filter(row => row.userId === where.userId && row.provider === where.provider && row.status === where.status &&
                (!where.id || row.id < where.id.lt))
            .sort((a, b) => b.id.localeCompare(a.id)).slice(0, take));
        tx.$queryRaw.mockResolvedValue([]);
        tx.purchase.findFirst.mockResolvedValue(null);
        tx.purchase.create.mockResolvedValue({ id: id(9), provider: 'DUMMY_PAY', status: 'PENDING', plan: 'KRONIQ', amount: { toFixed: () => '36.00' }, currency: 'EUR' });
        prisma.$transaction.mockImplementation(async callback => callback(tx));
    });
    afterAll(async () => { await app.close(); process.env = originalEnv; });
    const get = (query = '') => request(app.getHttpServer()).get(`/payments/dummy/pending${query}`).auth(bearer, { type: 'bearer' });
    const create = (plan = 'KRONIQ') => request(app.getHttpServer()).post('/payments/dummy').auth(bearer, { type: 'bearer' }).send({ plan });

    it('recovers all historical pending metadata, with no secret fields or writes', async () => {
        const response = await get().expect(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.body.items.map((row: any) => row.purchaseId)).toEqual([id(5), id(4), id(3)]);
        expect(response.body.nextCursor).toBeNull();
        response.body.items.forEach((row: any) => expect(Object.keys(row).sort()).toEqual(['purchaseId', 'provider', 'status', 'plan', 'createdAt'].sort()));
        expect(prisma.purchase.findMany).toHaveBeenCalledWith({
            where: { userId: owner, provider: 'DUMMY_PAY', status: 'PENDING' },
            orderBy: { id: 'desc' }, take: 21,
            select: { id: true, provider: true, status: true, plan: true, createdAt: true },
        });
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.user.update).not.toHaveBeenCalled();
    });
    it('paginates without offset and survives the cursor row being resolved or deleted', async () => {
        const first = await get('?limit=2').expect(200);
        expect(first.body.nextCursor).toBe(id(4));
        rows = rows.filter(row => row.id !== id(4));
        const second = await get(`?limit=2&cursor=${first.body.nextCursor}`).expect(200);
        expect(second.body.items.map((row: any) => row.purchaseId)).toEqual([id(3)]);
        expect(second.body.nextCursor).toBeNull();
    });
    it('returns an empty list, not 404', async () => {
        rows = [];
        expect((await get().expect(200)).body).toEqual({ items: [], nextCursor: null });
    });
    it('does not accept another owner through query parameters', async () => {
        const response = await get(`?userId=${foreign}`).expect(200);
        expect(response.body.items).toHaveLength(3);
        expect(response.body.items.map((row: any) => row.purchaseId)).not.toContain(id(6));
    });
    it.each(['?limit=0', '?limit=51', '?limit=1.5', '?limit=oops', '?cursor=invalid'])('validates %s', async query => {
        await get(query).expect(400);
        expect(prisma.purchase.findMany).not.toHaveBeenCalled();
    });
    it('requires JWT and rejects invalid access tokens', async () => {
        await request(app.getHttpServer()).get('/payments/dummy/pending').expect(401);
        await request(app.getHttpServer()).get('/payments/dummy/pending').auth('invalid', { type: 'bearer' }).expect(401);
        expect(prisma.purchase.findMany).not.toHaveBeenCalled();
    });
    it.each(['production', 'test', ''])('disables recovery and create in %s', async env => {
        process.env.NODE_ENV = env;
        await get().expect(404);
        await create().expect(404);
        expect(prisma.purchase.findMany).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
    it('allows staging recovery', async () => { process.env.NODE_ENV = 'staging'; await get().expect(200); });
    it.each(['PREMIUM', 'KRONIQ'])('refuses %s if any pending purchase exists', async plan => {
        tx.purchase.findFirst.mockResolvedValue({ id: id(3) });
        const response = await create(plan).expect(409);
        expect(response.body).toEqual({ statusCode: 409, code: 'DUMMY_PAY_PENDING_EXISTS', message: 'A pending DummyPay purchase already exists.' });
        expect(response.headers['cache-control']).toBe('no-store');
        expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
        expect(tx.purchase.findFirst).toHaveBeenCalledWith({ where: { userId: owner, provider: 'DUMMY_PAY', status: 'PENDING' }, select: { id: true } });
        expect(tx.purchase.create).not.toHaveBeenCalled();
        expect(prisma.user.update).not.toHaveBeenCalled();
    });
    it('retains the 201 response when no pending purchase exists', async () => {
        const response = await create().expect(201);
        expect(response.body).toEqual({ purchaseId: id(9), provider: 'DUMMY_PAY', status: 'PENDING', plan: 'KRONIQ', amount: '36.00', currency: 'EUR', paymentUrl: expect.stringMatching(/^https:\/\/test.invalid\/payments\/dummy\/.*\?token=/) });
        expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'ReadCommitted' });
        expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.purchase.findFirst.mock.invocationCallOrder[0]);
        expect(tx.purchase.findFirst.mock.invocationCallOrder[0]).toBeLessThan(tx.purchase.create.mock.invocationCallOrder[0]);
    });
    it('does not start a transaction or insert without PUBLIC_BASE_URL', async () => {
        delete process.env.PUBLIC_BASE_URL;
        await create().expect(500);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(tx.purchase.create).not.toHaveBeenCalled();
    });
    it.each([{ target: ['userId'] }, { target: 'Purchase_dummy_pending_user_unique' }])('maps future pending uniqueness conflict %j to 409', async ({ target }) => {
        tx.purchase.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('test conflict', { code: 'P2002', clientVersion: '6.16.2', meta: { target } }));
        expect((await create().expect(409)).body.code).toBe('DUMMY_PAY_PENDING_EXISTS');
    });
    it('does not mask unrelated uniqueness errors', async () => {
        tx.purchase.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('test conflict', { code: 'P2002', clientVersion: '6.16.2', meta: { target: ['id'] } }));
        await create().expect(500);
    });
});
