import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import request from 'supertest';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsModule } from './payments.module';
import { PaymentsService } from './payments.service';
import { ResolveDummyPaymentResult } from './dto/resolve-dummy-payment.dto';

describe('DummyPay continuation', () => {
    const originalEnv = process.env;
    const userId = '550e8400-e29b-41d4-a716-446655440001';
    const purchaseId = '550e8400-e29b-41d4-a716-446655440002';
    const oldToken = 'original-test-token';
    const hash = (token: string) => createHash('sha256').update(token).digest('hex');
    const jwt = new JwtService({ secret: 'continue-test-secret' });
    let app: INestApplication;
    let service: PaymentsService;
    let bearer: string;
    let purchase: any;
    let user: { isPremium: boolean; isKroniq: boolean };
    const tx = {
        purchase: { updateMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
        user: { update: jest.fn() },
    };
    const prisma = {
        purchase: { findFirst: jest.fn(), create: jest.fn() },
        user: { findFirst: jest.fn() }, $transaction: jest.fn(),
    };
    beforeAll(async () => {
        process.env = { ...originalEnv, JWT_SECRET: 'continue-test-secret' };
        const module = await Test.createTestingModule({
            imports: [PaymentsModule], providers: [JwtStrategy, { provide: PrismaService, useValue: prisma }],
        }).overrideProvider(PrismaService).useValue(prisma).compile();
        service = module.get(PaymentsService);
        app = module.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
        await app.init();
        bearer = jwt.sign({ sub: userId }, { expiresIn: '5m' });
    });
    beforeEach(() => {
        jest.resetAllMocks();
        process.env.NODE_ENV = 'development';
        process.env.PUBLIC_BASE_URL = 'https://payments.example.test/';
        purchase = {
            id: purchaseId, userId, provider: 'DUMMY_PAY', status: 'PENDING', plan: 'KRONIQ',
            resolvedAt: null, amount: { toFixed: () => '36.00' }, currency: 'EUR',
            accessTokenHash: hash(oldToken), providerReference: 'private',
        };
        user = { isPremium: true, isKroniq: false };
        const matches = (where: any) => Object.entries(where).every(([key, value]) => purchase[key] === value);
        const find = async ({ where }: any) => matches(where) ? { ...purchase } : null;
        prisma.user.findFirst.mockResolvedValue({ id: userId });
        prisma.purchase.findFirst.mockImplementation(find);
        tx.purchase.findFirst.mockImplementation(find);
        tx.purchase.findUnique.mockImplementation(find);
        // Conditional-update model only; real PostgreSQL locking is not simulated.
        tx.purchase.updateMany.mockImplementation(async ({ where, data }) => {
            if (!matches(where)) return { count: 0 };
            Object.assign(purchase, data);
            return { count: 1 };
        });
        tx.user.update.mockImplementation(async ({ data }) => Object.assign(user, data));
        prisma.$transaction.mockImplementation(async callback => callback(tx));
    });
    afterAll(async () => { await app.close(); process.env = originalEnv; });
    const resume = (id = purchaseId) => request(app.getHttpServer())
        .post(`/payments/dummy/${id}/continue`).auth(bearer, { type: 'bearer' });
    const resumeService = () => service.continueDummyPayment(userId, purchaseId);
    const resolveOld = (result = ResolveDummyPaymentResult.APPROVED) => service.resolveDummyPayment(purchaseId, oldToken, result);
    const urlToken = (response: { paymentUrl?: string }) => new URL(response.paymentUrl!).searchParams.get('token')!;
    const assertNoStore = (response: any) => expect(response.headers['cache-control']).toBe('no-store');

    it.each(['PREMIUM', 'KRONIQ'])('rotates %s without changing purchase data or active plan', async plan => {
        purchase.plan = plan;
        const before = { ...purchase };
        const response = await resume().expect(200);
        assertNoStore(response);
        expect(Object.keys(response.body).sort()).toEqual(['purchaseId', 'provider', 'status', 'plan', 'paymentUrl'].sort());
        expect(response.body).toMatchObject({ purchaseId, provider: 'DUMMY_PAY', status: 'PENDING', plan });
        const token = urlToken(response.body);
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(token).not.toBe(oldToken);
        expect(purchase).toEqual({ ...before, accessTokenHash: hash(token) });
        expect(tx.purchase.updateMany).toHaveBeenCalledWith({
            where: { id: purchaseId, userId, provider: 'DUMMY_PAY', status: 'PENDING' },
            data: { accessTokenHash: hash(token) },
        });
        expect(prisma.purchase.create).not.toHaveBeenCalled();
        expect(tx.user.update).not.toHaveBeenCalled();
        expect(user).toEqual({ isPremium: true, isKroniq: false });
        const old = await request(app.getHttpServer()).get(`/payments/dummy/${purchaseId}?token=${oldToken}`).expect(404);
        assertNoStore(old);
        const url = new URL(response.body.paymentUrl);
        const page = await request(app.getHttpServer()).get(url.pathname + url.search).expect(200);
        assertNoStore(page);
        expect(page.headers['referrer-policy']).toBe('no-referrer');
        const resolved = await request(app.getHttpServer()).post(`${url.pathname}/resolve${url.search}`)
            .type('form').send({ result: 'REFUSED' }).expect(201);
        assertNoStore(resolved);
        expect(resolved.headers['referrer-policy']).toBe('no-referrer');
        expect(purchase.status).toBe('FAILED');
        expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('allows the rotated token to approve once using the existing resolve flow', async () => {
        const response = await resumeService();
        const token = urlToken(response);
        expect(await service.resolveDummyPayment(purchaseId, token, ResolveDummyPaymentResult.APPROVED)).toContain('COMPLETED');
        expect(await service.resolveDummyPayment(purchaseId, token, ResolveDummyPaymentResult.APPROVED)).toContain('COMPLETED');
        expect(tx.user.update).toHaveBeenCalledTimes(1);
        expect(tx.purchase.updateMany).toHaveBeenLastCalledWith({
            where: { id: purchaseId, provider: 'DUMMY_PAY', status: 'PENDING', accessTokenHash: hash(token) },
            data: { status: 'COMPLETED', resolvedAt: expect.any(Date) },
        });
    });

    it.each([
        { isPremium: false, isKroniq: true },
        { isPremium: true, isKroniq: true },
        { isPremium: false, isKroniq: false },
    ])('does not change existing account flags %j', async flags => {
        user = { ...flags };
        await resume().expect(200);
        expect(user).toEqual(flags);
        expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('protects existing create, status and cancel HTTP responses too', async () => {
        prisma.purchase.create.mockImplementation(async () => purchase);
        assertNoStore(await request(app.getHttpServer()).post('/payments/dummy')
            .auth(bearer, { type: 'bearer' }).send({ plan: 'KRONIQ' }).expect(201));
        assertNoStore(await request(app.getHttpServer()).get(`/payments/dummy/${purchaseId}/status`)
            .auth(bearer, { type: 'bearer' }).expect(200));
        assertNoStore(await request(app.getHttpServer()).post(`/payments/dummy/${purchaseId}/cancel`)
            .auth(bearer, { type: 'bearer' }).expect(200));
    });

    it.each(['FAILED', 'COMPLETED'])('returns %s without URL, config dependency or writes', async status => {
        Object.assign(purchase, { status, resolvedAt: new Date() });
        const before = { ...purchase };
        delete process.env.PUBLIC_BASE_URL;
        const response = await resume().expect(200);
        expect(response.body).toEqual({ purchaseId, provider: 'DUMMY_PAY', status, plan: 'KRONIQ' });
        assertNoStore(response);
        expect(purchase).toEqual(before);
        expect(tx.purchase.updateMany).not.toHaveBeenCalled();
        expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('checks configuration before rotating', async () => {
        delete process.env.PUBLIC_BASE_URL;
        await resume().expect(500);
        expect(tx.purchase.updateMany).not.toHaveBeenCalled();
        expect(purchase.accessTokenHash).toBe(hash(oldToken));
    });

    it('requires JWT and validates UUID with no-store on error responses', async () => {
        const missing = await request(app.getHttpServer()).post(`/payments/dummy/${purchaseId}/continue?token=${oldToken}`).expect(401);
        assertNoStore(missing);
        for (const token of ['invalid', jwt.sign({ sub: userId }, { expiresIn: -1 })]) {
            assertNoStore(await request(app.getHttpServer()).post(`/payments/dummy/${purchaseId}/continue`)
                .auth(token, { type: 'bearer' }).expect(401));
        }
        assertNoStore(await resume('invalid').expect(400));
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects inactive users', async () => {
        prisma.user.findFirst.mockResolvedValue(null);
        await resume().expect(401);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns identical 404 for foreign, missing and other-provider purchases', async () => {
        purchase.userId = 'other-user';
        const foreign = await resume().expect(404);
        purchase.userId = userId;
        purchase.provider = 'GOOGLE_PLAY';
        const other = await resume().expect(404);
        const missing = await resume('550e8400-e29b-41d4-a716-446655440099').expect(404);
        expect(other.body).toEqual(foreign.body);
        expect(missing.body).toEqual(foreign.body);
        assertNoStore(foreign);
        expect(tx.purchase.updateMany).not.toHaveBeenCalled();
    });

    it.each(['production', 'test', ''])('rejects %s without DB access', async env => {
        process.env.NODE_ENV = env;
        assertNoStore(await resume().expect(404));
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
    it('allows staging', async () => { process.env.NODE_ENV = 'staging'; await resume().expect(200); });

    it('reissues safely after a lost response and invalidates the previous issue', async () => {
        const lost = await resumeService();
        const retry = await resumeService();
        expect(retry.paymentUrl).not.toBe(lost.paymentUrl);
        await expect(service.renderDummyPaymentPage(purchaseId, urlToken(lost))).rejects.toMatchObject({ status: 404 });
        expect(await service.renderDummyPaymentPage(purchaseId, urlToken(retry))).toContain('PENDING');
        expect(prisma.purchase.create).not.toHaveBeenCalled();
    });

    it('handles two concurrent Continue requests with only the last token valid', async () => {
        const responses = await Promise.all([resumeService(), resumeService()]);
        expect(responses[0].paymentUrl).not.toBe(responses[1].paymentUrl);
        const valid = responses.filter(response => hash(urlToken(response)) === purchase.accessTokenHash);
        expect(valid).toHaveLength(1);
        const invalid = responses.find(response => response !== valid[0])!;
        await expect(service.renderDummyPaymentPage(purchaseId, urlToken(invalid))).rejects.toMatchObject({ status: 404 });
        expect(prisma.purchase.create).not.toHaveBeenCalled();
        expect(tx.user.update).not.toHaveBeenCalled();
    });

    it.each([ResolveDummyPaymentResult.APPROVED, ResolveDummyPaymentResult.REFUSED])('rejects stale %s verified before rotation', async result => {
        const update = tx.purchase.updateMany.getMockImplementation()!;
        let entered!: () => void;
        const ready = new Promise<void>(resolve => { entered = resolve; });
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        tx.purchase.updateMany.mockImplementation(async args => {
            if (args.data.status) { entered(); await gate; }
            return update(args);
        });
        const stale = resolveOld(result);
        const rejection = expect(stale).rejects.toMatchObject({ status: 404 });
        await ready;
        await resumeService();
        release();
        await rejection;
        expect(purchase.status).toBe('PENDING');
        expect(purchase.resolvedAt).toBeNull();
        expect(tx.user.update).not.toHaveBeenCalled();
        expect(user).toEqual({ isPremium: true, isKroniq: false });
    });

    it.each(['cancel', 'approve'])('returns final state without URL when %s wins after Continue read', async operation => {
        const update = tx.purchase.updateMany.getMockImplementation()!;
        let entered!: () => void;
        const ready = new Promise<void>(resolve => { entered = resolve; });
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        tx.purchase.updateMany.mockImplementation(async args => {
            if (args.data.accessTokenHash) { entered(); await gate; }
            return update(args);
        });
        const pending = resumeService();
        await ready;
        if (operation === 'cancel') await service.cancelDummyPayment(userId, purchaseId);
        else await resolveOld();
        release();
        const response = await pending;
        expect(response).toEqual({ purchaseId, provider: 'DUMMY_PAY', status: operation === 'cancel' ? 'FAILED' : 'COMPLETED', plan: 'KRONIQ' });
        expect(tx.user.update).toHaveBeenCalledTimes(operation === 'cancel' ? 0 : 1);
    });

    it('prevents old and new links from activating after Continue then Cancel', async () => {
        const response = await resumeService();
        await service.cancelDummyPayment(userId, purchaseId);
        await expect(resolveOld()).rejects.toMatchObject({ status: 404 });
        expect(await service.resolveDummyPayment(purchaseId, urlToken(response), ResolveDummyPaymentResult.APPROVED)).toContain('FAILED');
        expect(tx.user.update).not.toHaveBeenCalled();
        expect(user).toEqual({ isPremium: true, isKroniq: false });
    });
});
