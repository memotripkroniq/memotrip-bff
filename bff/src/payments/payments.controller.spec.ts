import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PurchasePlan, PurchaseProvider, PurchaseStatus } from '@prisma/client';
import request from 'supertest';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

describe('PaymentsController HTTP', () => {
    const userId = '550e8400-e29b-41d4-a716-446655440001';
    const purchaseId = '550e8400-e29b-41d4-a716-446655440002';
    const originalEnv = process.env;
    const jwt = new JwtService({ secret: 'payments-controller-test-secret' });
    const prisma = {
        user: { findFirst: jest.fn(), update: jest.fn() },
        purchase: { findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
        $transaction: jest.fn(),
    };
    let app: INestApplication;
    let token: string;
    let purchase: Record<string, unknown>;

    beforeAll(async () => {
        process.env = { ...originalEnv, JWT_SECRET: 'payments-controller-test-secret' };
        const module = await Test.createTestingModule({
            controllers: [PaymentsController],
            providers: [PaymentsService, JwtStrategy, { provide: PrismaService, useValue: prisma }],
        }).compile();
        app = module.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
        await app.init();
        token = jwt.sign({ sub: userId }, { expiresIn: '5m' });
    });

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.NODE_ENV = 'development';
        purchase = {
            id: purchaseId, userId, provider: PurchaseProvider.DUMMY_PAY,
            status: PurchaseStatus.PENDING, plan: PurchasePlan.PREMIUM,
            accessTokenHash: 'secret-hash', providerReference: 'private-reference',
            paymentUrl: 'private-url', amount: '5.99', currency: 'EUR',
        };
        prisma.user.findFirst.mockResolvedValue({ id: userId });
        // Model ownership/provider filtering while deliberately returning extra fields.
        prisma.purchase.findFirst.mockImplementation(async ({ where }) =>
            Object.entries(where).every(([key, value]) => purchase[key] === value) ? purchase : null,
        );
    });

    afterAll(async () => {
        await app.close();
        process.env = originalEnv;
    });

    const getStatus = (id = purchaseId) => request(app.getHttpServer())
        .get(`/payments/dummy/${id}/status`).auth(token, { type: 'bearer' });

    it.each(Object.values(PurchaseStatus).flatMap(status =>
        Object.values(PurchasePlan).map(plan => [status, plan]),
    ))('returns only public fields for %s / %s', async (status, plan) => {
        purchase.status = status;
        purchase.plan = plan;
        const response = await getStatus().expect(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['content-type']).toContain('application/json');
        expect(response.body).toEqual({ purchaseId, provider: 'DUMMY_PAY', status, plan });
        expect(prisma.purchase.findFirst).toHaveBeenCalledWith({
            where: { id: purchaseId, userId, provider: 'DUMMY_PAY' },
            select: { id: true, provider: true, status: true, plan: true },
        });
        expect(prisma.purchase.create).not.toHaveBeenCalled();
        expect(prisma.purchase.updateMany).not.toHaveBeenCalled();
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects invalid UUID before reading a purchase', async () => {
        await getStatus('invalid').expect(400);
        expect(prisma.purchase.findFirst).not.toHaveBeenCalled();
    });

    it('requires JWT even when a payment URL token is supplied', async () => {
        await request(app.getHttpServer()).get(`/payments/dummy/${purchaseId}/status?token=payment-token`).expect(401);
        expect(prisma.purchase.findFirst).not.toHaveBeenCalled();
    });

    it('rejects invalid and expired JWTs', async () => {
        for (const bearer of ['invalid', jwt.sign({ sub: userId }, { expiresIn: -1 })]) {
            await request(app.getHttpServer()).get(`/payments/dummy/${purchaseId}/status`)
                .auth(bearer, { type: 'bearer' }).expect(401);
        }
        expect(prisma.purchase.findFirst).not.toHaveBeenCalled();
    });

    it('rejects a JWT belonging to an inactive user', async () => {
        prisma.user.findFirst.mockResolvedValue(null);
        await getStatus().expect(401);
        expect(prisma.purchase.findFirst).not.toHaveBeenCalled();
    });

    it('returns the same 404 for foreign, missing and Google Play purchases', async () => {
        purchase.userId = 'other-user';
        const foreign = await getStatus().expect(404);
        purchase.userId = userId;
        purchase.provider = PurchaseProvider.GOOGLE_PLAY;
        const google = await getStatus().expect(404);
        const missing = await getStatus('550e8400-e29b-41d4-a716-446655440099').expect(404);
        expect(foreign.body).toEqual(missing.body);
        expect(google.body).toEqual(missing.body);
    });

    it.each(['APPROVED', 'REFUSED'])('preserves create / HTML / resolve flow for %s', async result => {
        process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
        prisma.purchase.create.mockImplementation(async ({ data }) => {
            purchase = { ...data, id: purchaseId, amount: { toFixed: () => '5.99' } };
            return purchase;
        });
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([]),
            purchase: {
                create: prisma.purchase.create,
                findFirst: jest.fn().mockResolvedValue(null),
                updateMany: jest.fn(async ({ data }) => { Object.assign(purchase, data); return { count: 1 }; }),
                findUnique: jest.fn(async () => purchase),
            },
            user: { update: jest.fn(async () => ({ id: userId })) },
        };
        prisma.$transaction.mockImplementation(async callback => callback(tx));
        const created = await request(app.getHttpServer()).post('/payments/dummy')
            .auth(token, { type: 'bearer' }).send({ plan: 'PREMIUM' }).expect(201);
        expect(created.body).toMatchObject({ purchaseId, status: 'PENDING', plan: 'PREMIUM' });
        const paymentUrl = new URL(created.body.paymentUrl);
        const html = await request(app.getHttpServer()).get(paymentUrl.pathname + paymentUrl.search).expect(200);
        expect(html.headers['content-type']).toContain('text/html');
        expect(html.text).toContain('APPROVED');
        expect(html.text).toContain('REFUSED');
        const resolved = await request(app.getHttpServer())
            .post(`${paymentUrl.pathname}/resolve${paymentUrl.search}`)
            .type('form').send({ result }).expect(201);
        const status = result === 'APPROVED' ? 'COMPLETED' : 'FAILED';
        expect(resolved.headers['content-type']).toContain('text/html');
        expect(resolved.text).toContain(status);
        const current = await getStatus().expect(200);
        expect(current.body.status).toBe(status);
        expect(tx.user.update).toHaveBeenCalledTimes(result === 'APPROVED' ? 1 : 0);
        await request(app.getHttpServer()).post(`${paymentUrl.pathname}/resolve${paymentUrl.search}`)
            .type('form').send({ result: result === 'APPROVED' ? 'REFUSED' : 'APPROVED' }).expect(201);
        expect(purchase.status).toBe(status);
        expect(tx.purchase.updateMany).toHaveBeenCalledTimes(1);
    });

    it('is available in staging', async () => {
        process.env.NODE_ENV = 'staging';
        await getStatus().expect(200);
    });

    it.each(['production', 'test', ''])('is disabled in %s', async env => {
        process.env.NODE_ENV = env;
        await getStatus().expect(404);
        expect(prisma.purchase.findFirst).not.toHaveBeenCalled();
    });
});
