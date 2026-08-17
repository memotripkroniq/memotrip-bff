import { NotFoundException } from '@nestjs/common';
import { PurchasePlan, PurchaseProvider, PurchaseStatus } from '@prisma/client';
import { ResolveDummyPaymentResult } from './dto/resolve-dummy-payment.dto';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetAllMocks();
        process.env = {
            ...originalEnv,
            NODE_ENV: 'development',
            PUBLIC_BASE_URL: 'http://localhost:3000/',
        };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    function createService() {
        const tx = {
            purchase: {
                updateMany: jest.fn(),
                findUnique: jest.fn(),
            },
            user: {
                update: jest.fn(),
            },
        };
        const prisma = {
            purchase: {
                create: jest.fn(),
                findFirst: jest.fn(),
            },
            $transaction: jest.fn(async (callback: (tx: typeof tx) => Promise<unknown>) => callback(tx)),
        };

        return {
            prisma,
            tx,
            service: new PaymentsService(prisma as any),
        };
    }

    it('creates a PENDING PREMIUM DummyPay purchase with backend-defined price', async () => {
        const { prisma, service } = createService();
        prisma.purchase.create.mockResolvedValue({
            id: 'purchase-1',
            provider: PurchaseProvider.DUMMY_PAY,
            status: PurchaseStatus.PENDING,
            plan: PurchasePlan.PREMIUM,
            amount: { toFixed: () => '5.99' },
            currency: 'EUR',
        });

        const result = await service.createDummyPayment('user-1', PurchasePlan.PREMIUM);

        expect(prisma.purchase.create).toHaveBeenCalledWith({
            data: {
                userId: 'user-1',
                plan: PurchasePlan.PREMIUM,
                provider: PurchaseProvider.DUMMY_PAY,
                status: PurchaseStatus.PENDING,
                amount: '5.99',
                currency: 'EUR',
                providerReference: null,
                accessTokenHash: expect.any(String),
                resolvedAt: null,
            },
            select: {
                id: true,
                provider: true,
                status: true,
                plan: true,
                amount: true,
                currency: true,
            },
        });
        expect(result).toEqual({
            purchaseId: 'purchase-1',
            provider: PurchaseProvider.DUMMY_PAY,
            status: PurchaseStatus.PENDING,
            plan: PurchasePlan.PREMIUM,
            amount: '5.99',
            currency: 'EUR',
            paymentUrl: expect.stringMatching(
                /^http:\/\/localhost:3000\/payments\/dummy\/purchase-1\?token=.+$/,
            ),
        });
    });

    it('creates a PENDING KRONIQ DummyPay purchase with backend-defined price', async () => {
        const { prisma, service } = createService();
        prisma.purchase.create.mockResolvedValue({
            id: 'purchase-2',
            provider: PurchaseProvider.DUMMY_PAY,
            status: PurchaseStatus.PENDING,
            plan: PurchasePlan.KRONIQ,
            amount: { toFixed: () => '36.00' },
            currency: 'EUR',
        });

        const result = await service.createDummyPayment('user-2', PurchasePlan.KRONIQ);

        expect(prisma.purchase.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    userId: 'user-2',
                    plan: PurchasePlan.KRONIQ,
                    amount: '36.00',
                    currency: 'EUR',
                }),
            }),
        );
        expect(result.plan).toBe(PurchasePlan.KRONIQ);
        expect(result.amount).toBe('36.00');
        expect(result.status).toBe(PurchaseStatus.PENDING);
    });

    it('stores only SHA-256 hash, not the plaintext access token', async () => {
        const { prisma, service } = createService();
        prisma.purchase.create.mockResolvedValue({
            id: 'purchase-3',
            provider: PurchaseProvider.DUMMY_PAY,
            status: PurchaseStatus.PENDING,
            plan: PurchasePlan.PREMIUM,
            amount: { toFixed: () => '5.99' },
            currency: 'EUR',
        });

        const result = await service.createDummyPayment('user-3', PurchasePlan.PREMIUM);

        const paymentUrl = new URL(result.paymentUrl);
        const plaintextToken = paymentUrl.searchParams.get('token');
        const storedHash = prisma.purchase.create.mock.calls[0][0].data.accessTokenHash;

        expect(plaintextToken).toBeTruthy();
        expect(storedHash).toHaveLength(64);
        expect(storedHash).not.toBe(plaintextToken);
    });

    it('rejects DummyPay in production environments', async () => {
        const { prisma, service } = createService();
        process.env.NODE_ENV = 'production';

        await expect(
            service.createDummyPayment('user-4', PurchasePlan.PREMIUM),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.purchase.create).not.toHaveBeenCalled();
    });

    it('renders DummyPay page for a valid token', async () => {
        const { prisma, service } = createService();
        prisma.purchase.create.mockResolvedValue({
            id: 'purchase-page',
            provider: PurchaseProvider.DUMMY_PAY,
            status: PurchaseStatus.PENDING,
            plan: PurchasePlan.PREMIUM,
            amount: { toFixed: () => '5.99' },
            currency: 'EUR',
        });

        const created = await service.createDummyPayment('user-page', PurchasePlan.PREMIUM);
        const url = new URL(created.paymentUrl);
        const token = url.searchParams.get('token')!;

        prisma.purchase.findFirst.mockResolvedValue({
            id: 'purchase-page',
            userId: 'user-page',
            plan: PurchasePlan.PREMIUM,
            provider: PurchaseProvider.DUMMY_PAY,
            status: PurchaseStatus.PENDING,
            amount: { toFixed: () => '5.99' },
            currency: 'EUR',
            accessTokenHash: prisma.purchase.create.mock.calls[0][0].data.accessTokenHash,
        });

        const html = await service.renderDummyPaymentPage('purchase-page', token);

        expect(html).toContain('MemoTrip DummyPay');
        expect(html).toContain('purchase-page');
        expect(html).toContain('PREMIUM');
        expect(html).toContain('5.99');
        expect(html).toContain('EUR');
        expect(html).toContain('PENDING');
        expect(html).toContain('APPROVED');
        expect(html).toContain('REFUSED');
    });

    it('returns 404 for invalid DummyPay token', async () => {
        const { prisma, service } = createService();
        prisma.purchase.findFirst.mockResolvedValue({
            id: 'purchase-invalid',
            userId: 'user-invalid',
            plan: PurchasePlan.PREMIUM,
            provider: PurchaseProvider.DUMMY_PAY,
            status: PurchaseStatus.PENDING,
            amount: { toFixed: () => '5.99' },
            currency: 'EUR',
            accessTokenHash: 'f'.repeat(64),
        });

        await expect(
            service.renderDummyPaymentPage('purchase-invalid', 'wrong-token'),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('approves PREMIUM purchase and sets user flags to true/false', async () => {
        const { prisma, tx, service } = createService();
        prisma.purchase.findFirst.mockResolvedValue({
            id: 'purchase-premium',
            userId: 'user-premium',
            plan: PurchasePlan.PREMIUM,
            provider: PurchaseProvider.DUMMY_PAY,
            status: PurchaseStatus.PENDING,
            amount: { toFixed: () => '5.99' },
            currency: 'EUR',
            accessTokenHash: 'a'.repeat(64),
        });

        const source = jest.spyOn<any, any>(service as any, 'createTokenHash').mockReturnValue('a'.repeat(64));
        tx.purchase.updateMany.mockResolvedValue({ count: 1 });

        const html = await service.resolveDummyPayment(
            'purchase-premium',
            'valid-token',
            ResolveDummyPaymentResult.APPROVED,
        );

        expect(tx.purchase.updateMany).toHaveBeenCalledWith({
            where: {
                id: 'purchase-premium',
                status: PurchaseStatus.PENDING,
            },
            data: {
                status: PurchaseStatus.COMPLETED,
                resolvedAt: expect.any(Date),
            },
        });
        expect(tx.user.update).toHaveBeenCalledWith({
            where: { id: 'user-premium' },
            data: {
                isPremium: true,
                isKroniq: false,
            },
        });
        expect(html).toContain('Payment approved');
        expect(html).toContain('COMPLETED');
        source.mockRestore();
    });

    it('approves KRONIQ purchase and sets user flags to false/true', async () => {
        const { prisma, tx, service } = createService();
        prisma.purchase.findFirst.mockResolvedValue({
            id: 'purchase-kroniq',
            userId: 'user-kroniq',
            plan: PurchasePlan.KRONIQ,
            provider: PurchaseProvider.DUMMY_PAY,
            status: PurchaseStatus.PENDING,
            amount: { toFixed: () => '36.00' },
            currency: 'EUR',
            accessTokenHash: 'b'.repeat(64),
        });

        const source = jest.spyOn<any, any>(service as any, 'createTokenHash').mockReturnValue('b'.repeat(64));
        tx.purchase.updateMany.mockResolvedValue({ count: 1 });

        const html = await service.resolveDummyPayment(
            'purchase-kroniq',
            'valid-token',
            ResolveDummyPaymentResult.APPROVED,
        );

        expect(tx.user.update).toHaveBeenCalledWith({
            where: { id: 'user-kroniq' },
            data: {
                isPremium: false,
                isKroniq: true,
            },
        });
        expect(html).toContain('Payment approved');
        expect(html).toContain('COMPLETED');
        source.mockRestore();
    });

    it('refuses purchase and leaves user flags unchanged', async () => {
        const { prisma, tx, service } = createService();
        prisma.purchase.findFirst.mockResolvedValue({
            id: 'purchase-refused',
            userId: 'user-refused',
            plan: PurchasePlan.PREMIUM,
            provider: PurchaseProvider.DUMMY_PAY,
            status: PurchaseStatus.PENDING,
            amount: { toFixed: () => '5.99' },
            currency: 'EUR',
            accessTokenHash: 'c'.repeat(64),
        });

        const source = jest.spyOn<any, any>(service as any, 'createTokenHash').mockReturnValue('c'.repeat(64));
        tx.purchase.updateMany.mockResolvedValue({ count: 1 });

        const html = await service.resolveDummyPayment(
            'purchase-refused',
            'valid-token',
            ResolveDummyPaymentResult.REFUSED,
        );

        expect(tx.purchase.updateMany).toHaveBeenCalledWith({
            where: {
                id: 'purchase-refused',
                status: PurchaseStatus.PENDING,
            },
            data: {
                status: PurchaseStatus.FAILED,
                resolvedAt: expect.any(Date),
            },
        });
        expect(tx.user.update).not.toHaveBeenCalled();
        expect(html).toContain('Payment refused');
        expect(html).toContain('FAILED');
        source.mockRestore();
    });

    it('does not change already resolved purchase on second resolve', async () => {
        const { prisma, tx, service } = createService();
        prisma.purchase.findFirst.mockResolvedValue({
            id: 'purchase-resolved',
            userId: 'user-resolved',
            plan: PurchasePlan.PREMIUM,
            provider: PurchaseProvider.DUMMY_PAY,
            status: PurchaseStatus.COMPLETED,
            amount: { toFixed: () => '5.99' },
            currency: 'EUR',
            accessTokenHash: 'd'.repeat(64),
        });

        const source = jest.spyOn<any, any>(service as any, 'createTokenHash').mockReturnValue('d'.repeat(64));

        const html = await service.resolveDummyPayment(
            'purchase-resolved',
            'valid-token',
            ResolveDummyPaymentResult.REFUSED,
        );

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(tx.purchase.updateMany).not.toHaveBeenCalled();
        expect(tx.user.update).not.toHaveBeenCalled();
        expect(html).toContain('Payment approved');
        expect(html).toContain('COMPLETED');
        source.mockRestore();
    });

    it('rejects DummyPay page and resolve in production environments', async () => {
        const { prisma, service } = createService();
        process.env.NODE_ENV = 'production';

        await expect(
            service.renderDummyPaymentPage('purchase-prod', 'token'),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(
            service.resolveDummyPayment(
                'purchase-prod',
                'token',
                ResolveDummyPaymentResult.APPROVED,
            ),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.purchase.findFirst).not.toHaveBeenCalled();
    });
});
