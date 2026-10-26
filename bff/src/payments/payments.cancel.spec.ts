import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import request from 'supertest';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ResolveDummyPaymentResult } from './dto/resolve-dummy-payment.dto';

describe('DummyPay cancellation', () => {
    const originalEnv = process.env;
    const userId = '550e8400-e29b-41d4-a716-446655440001';
    const purchaseId = '550e8400-e29b-41d4-a716-446655440002';
    const paymentToken = 'test-payment-token';
    const jwt = new JwtService({ secret: 'cancel-test-secret' });
    let app: INestApplication;
    let service: PaymentsService;
    let bearer: string;
    let purchase: any;
    let user: { isPremium: boolean; isKroniq: boolean };
    const matches = (where: Record<string, unknown>) =>
        Object.entries(where).every(([key, value]) => purchase[key] === value);
    const tx = {
        purchase: { updateMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
        user: { update: jest.fn() },
    };
    const prisma = {
        purchase: { findFirst: jest.fn(), create: jest.fn() },
        user: { findFirst: jest.fn() },
        $transaction: jest.fn(),
    };

    beforeAll(async () => {
        process.env = { ...originalEnv, JWT_SECRET: 'cancel-test-secret' };
        const module = await Test.createTestingModule({
            controllers: [PaymentsController],
            providers: [PaymentsService, JwtStrategy, { provide: PrismaService, useValue: prisma }],
        }).compile();
        service = module.get(PaymentsService);
        app = module.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
        await app.init();
        bearer = jwt.sign({ sub: userId }, { expiresIn: '5m' });
    });

    beforeEach(() => {
        jest.resetAllMocks();
        process.env.NODE_ENV = 'development';
        purchase = {
            id: purchaseId, userId, provider: 'DUMMY_PAY', status: 'PENDING', plan: 'KRONIQ',
            resolvedAt: null, amount: { toFixed: () => '36.00' }, currency: 'EUR',
            accessTokenHash: createHash('sha256').update(paymentToken).digest('hex'),
            providerReference: 'private-reference',
        };
        user = { isPremium: true, isKroniq: false };
        prisma.user.findFirst.mockResolvedValue({ id: userId });
        // A conditional-update model for unit tests, not a substitute for PostgreSQL locking tests.
        const find = async ({ where }: any) => matches(where) ? { ...purchase } : null;
        prisma.purchase.findFirst.mockImplementation(find);
        tx.purchase.findFirst.mockImplementation(find);
        tx.purchase.findUnique.mockImplementation(find);
        tx.purchase.updateMany.mockImplementation(async ({ where, data }) => {
            if (!matches(where)) return { count: 0 };
            Object.assign(purchase, data);
            return { count: 1 };
        });
        tx.user.update.mockImplementation(async ({ data }) => Object.assign(user, data));
        prisma.$transaction.mockImplementation(async callback => callback(tx));
    });

    afterAll(async () => {
        await app.close();
        process.env = originalEnv;
    });

    const cancel = (id = purchaseId) => request(app.getHttpServer())
        .post(`/payments/dummy/${id}/cancel`).auth(bearer, { type: 'bearer' });
    const approve = () => service.resolveDummyPayment(purchaseId, paymentToken, ResolveDummyPaymentResult.APPROVED);

    it.each(['PREMIUM', 'KRONIQ'])('cancels %s with only public fields and no entitlement change', async plan => {
        purchase.plan = plan;
        const response = await cancel().expect(200);
        expect(response.body).toEqual({ purchaseId, provider: 'DUMMY_PAY', status: 'FAILED', plan });
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['content-type']).toContain('application/json');
        expect(tx.purchase.updateMany).toHaveBeenCalledWith({
            where: { id: purchaseId, userId, provider: 'DUMMY_PAY', status: 'PENDING' },
            data: { status: 'FAILED', resolvedAt: expect.any(Date) },
        });
        expect(tx.purchase.findFirst).toHaveBeenCalledWith({
            where: { id: purchaseId, userId, provider: 'DUMMY_PAY' },
            select: { id: true, provider: true, status: true, plan: true },
        });
        expect(user).toEqual({ isPremium: true, isKroniq: false });
        expect(tx.user.update).not.toHaveBeenCalled();
        expect(prisma.purchase.create).not.toHaveBeenCalled();
    });

    it.each(['FAILED', 'COMPLETED'])('leaves an already %s purchase and active plan unchanged', async status => {
        const resolvedAt = new Date('2026-01-01T00:00:00Z');
        Object.assign(purchase, { status, resolvedAt });
        const before = { ...purchase };
        const first = await cancel().expect(200);
        const second = await cancel().expect(200);
        expect(first.body.status).toBe(status);
        expect(second.body).toEqual(first.body);
        expect(purchase).toEqual(before);
        expect(user).toEqual({ isPremium: true, isKroniq: false });
        expect(tx.user.update).not.toHaveBeenCalled();
    });

    it.each([
        { isPremium: false, isKroniq: true },
        { isPremium: true, isKroniq: true },
        { isPremium: false, isKroniq: false },
    ])('preserves existing account flags %j', async flags => {
        user = { ...flags };
        await cancel().expect(200);
        expect(user).toEqual(flags);
        expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('handles simultaneous repeated cancels with only one state transition', async () => {
        const results = await Promise.all([
            service.cancelDummyPayment(userId, purchaseId),
            service.cancelDummyPayment(userId, purchaseId),
        ]);
        expect(results[0]).toEqual(results[1]);
        expect(results[0].status).toBe('FAILED');
        const updates = await Promise.all(tx.purchase.updateMany.mock.results.map(result => result.value));
        expect(updates.map(result => result.count).sort()).toEqual([0, 1]);
        expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('retries safely after cancellation and preserves the original resolution timestamp', async () => {
        const first = await cancel().expect(200);
        const resolvedAt = purchase.resolvedAt;
        const retry = await cancel().expect(200);
        expect(retry.body).toEqual(first.body);
        expect(purchase.resolvedAt).toBe(resolvedAt);
        const status = await request(app.getHttpServer()).get(`/payments/dummy/${purchaseId}/status`)
            .auth(bearer, { type: 'bearer' }).expect(200);
        expect(status.body).toEqual(first.body);
    });

    it('does not authorize cancellation with a payment URL token', async () => {
        await request(app.getHttpServer()).post(`/payments/dummy/${purchaseId}/cancel?token=${paymentToken}`).expect(401);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects invalid/expired access tokens and inactive users', async () => {
        for (const token of ['invalid', jwt.sign({ sub: userId }, { expiresIn: -1 })]) {
            await request(app.getHttpServer()).post(`/payments/dummy/${purchaseId}/cancel`)
                .auth(token, { type: 'bearer' }).expect(401);
        }
        prisma.user.findFirst.mockResolvedValue(null);
        await cancel().expect(401);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects invalid UUID before any transaction', async () => {
        await cancel('invalid').expect(400);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns the same 404 for foreign, missing and other-provider purchases without changes', async () => {
        purchase.userId = 'another-user';
        const foreign = await cancel().expect(404);
        expect(purchase.status).toBe('PENDING');
        purchase.userId = userId;
        purchase.provider = 'GOOGLE_PLAY';
        const other = await cancel().expect(404);
        expect(purchase.status).toBe('PENDING');
        const missing = await cancel('550e8400-e29b-41d4-a716-446655440099').expect(404);
        expect(other.body).toEqual(foreign.body);
        expect(missing.body).toEqual(foreign.body);
        expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('allows staging', async () => {
        process.env.NODE_ENV = 'staging';
        await cancel().expect(200);
    });

    it.each(['production', 'test', ''])('rejects environment %s before any transaction', async env => {
        process.env.NODE_ENV = env;
        await cancel().expect(404);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not let an old payment link activate a cancelled purchase', async () => {
        await cancel().expect(200);
        const page = await request(app.getHttpServer())
            .get(`/payments/dummy/${purchaseId}?token=${paymentToken}`).expect(200);
        expect(page.text).toContain('FAILED');
        expect(page.text).not.toContain('<form');
        const resolved = await request(app.getHttpServer())
            .post(`/payments/dummy/${purchaseId}/resolve?token=${paymentToken}`)
            .type('form').send({ result: 'APPROVED' }).expect(201);
        expect(resolved.text).toContain('FAILED');
        expect(tx.user.update).not.toHaveBeenCalled();
        expect(user).toEqual({ isPremium: true, isKroniq: false });
    });

    it.each(['cancel', 'approve'])('preserves the winner when %s updates first after both operations started', async winner => {
        let arrived = 0;
        let bothArrived!: () => void;
        const ready = new Promise<void>(resolve => { bothArrived = resolve; });
        let releaseLoser!: () => void;
        const loserGate = new Promise<void>(resolve => { releaseLoser = resolve; });
        const update = tx.purchase.updateMany.getMockImplementation()!;
        tx.purchase.updateMany.mockImplementation(async args => {
            const operation = args.data.status === 'FAILED' ? 'cancel' : 'approve';
            if (++arrived === 2) bothArrived();
            await ready;
            if (operation !== winner) await loserGate;
            return update(args);
        });
        const cancelling = service.cancelDummyPayment(userId, purchaseId);
        const approving = approve();
        await ready;
        if (winner === 'cancel') {
            expect((await cancelling).status).toBe('FAILED');
            releaseLoser();
            expect(await approving).toContain('FAILED');
            expect(tx.user.update).not.toHaveBeenCalled();
            expect(user).toEqual({ isPremium: true, isKroniq: false });
        } else {
            expect(await approving).toContain('COMPLETED');
            releaseLoser();
            expect((await cancelling).status).toBe('COMPLETED');
            expect(tx.user.update).toHaveBeenCalledTimes(1);
            expect(user).toEqual({ isPremium: false, isKroniq: true });
        }
    });
});
