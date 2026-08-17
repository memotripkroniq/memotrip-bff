import {
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import {
    Prisma,
    PurchasePlan,
    PurchaseProvider,
    PurchaseStatus,
} from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ResolveDummyPaymentResult } from './dto/resolve-dummy-payment.dto';

const DUMMY_PAY_PRICES: Record<PurchasePlan, { amount: string; currency: string }> = {
    [PurchasePlan.PREMIUM]: { amount: '5.99', currency: 'EUR' },
    [PurchasePlan.KRONIQ]: { amount: '36.00', currency: 'EUR' },
};

@Injectable()
export class PaymentsService {
    constructor(private readonly prisma: PrismaService) {}

    private assertDummyPayEnabled() {
        const env = (process.env.NODE_ENV ?? '').trim().toLowerCase();
        if (env !== 'development' && env !== 'staging') {
            throw new NotFoundException('DummyPay is not available');
        }
    }

    private getPublicBaseUrl(): string {
        const value = process.env.PUBLIC_BASE_URL?.trim();
        if (!value) {
            throw new InternalServerErrorException('PUBLIC_BASE_URL is not configured');
        }

        return value.replace(/\/$/, '');
    }

    private createOpaqueToken(): string {
        return randomBytes(32).toString('base64url');
    }

    private createTokenHash(token: string): string {
        return createHash('sha256').update(token).digest('hex');
    }

    private tokenMatchesHash(token: string | undefined, storedHash: string | null): boolean {
        if (!token || !storedHash) {
            return false;
        }

        const actual = Buffer.from(this.createTokenHash(token), 'utf8');
        const expected = Buffer.from(storedHash, 'utf8');

        if (actual.length !== expected.length) {
            return false;
        }

        return timingSafeEqual(actual, expected);
    }

    private formatAmount(amount: Prisma.Decimal | { toFixed: (digits: number) => string }) {
        return amount.toFixed(2);
    }

    private escapeHtml(value: string) {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private renderDummyPayHtml(params: {
        purchaseId: string;
        plan: PurchasePlan;
        amount: string;
        currency: string;
        status: PurchaseStatus;
        token: string;
    }) {
        const purchaseId = this.escapeHtml(params.purchaseId);
        const plan = this.escapeHtml(params.plan);
        const amount = this.escapeHtml(params.amount);
        const currency = this.escapeHtml(params.currency);
        const status = this.escapeHtml(params.status);
        const action = `/payments/dummy/${purchaseId}/resolve?token=${encodeURIComponent(params.token)}`;
        const actions = params.status === PurchaseStatus.PENDING
            ? `
                <form method="post" action="${this.escapeHtml(action)}">
                    <input type="hidden" name="result" value="APPROVED" />
                    <button type="submit">APPROVED</button>
                </form>
                <form method="post" action="${this.escapeHtml(action)}">
                    <input type="hidden" name="result" value="REFUSED" />
                    <button type="submit">REFUSED</button>
                </form>
            `
            : `
                <p>This payment has already been resolved.</p>
                <button type="button" disabled>APPROVED</button>
                <button type="button" disabled>REFUSED</button>
            `;

        return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MemoTrip DummyPay</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f6f7fb; color: #1f2937; margin: 0; padding: 32px 16px; }
      .card { max-width: 560px; margin: 0 auto; background: white; border-radius: 16px; padding: 24px; box-shadow: 0 10px 35px rgba(15, 23, 42, 0.08); }
      h1 { margin-top: 0; font-size: 28px; }
      dl { display: grid; grid-template-columns: 140px 1fr; gap: 12px 16px; margin: 24px 0; }
      dt { font-weight: 700; }
      dd { margin: 0; word-break: break-word; }
      .actions { display: flex; gap: 12px; flex-wrap: wrap; }
      form { margin: 0; }
      button { border: 0; border-radius: 10px; padding: 12px 18px; font-size: 15px; cursor: pointer; }
      button[value="APPROVED"], .approve { background: #15803d; color: white; }
      button[value="REFUSED"], .refuse { background: #b91c1c; color: white; }
      button[disabled] { background: #d1d5db; color: #6b7280; cursor: not-allowed; }
      .token-note { color: #6b7280; font-size: 13px; margin-top: 16px; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>MemoTrip DummyPay</h1>
      <dl>
        <dt>purchaseId</dt><dd>${purchaseId}</dd>
        <dt>plan</dt><dd>${plan}</dd>
        <dt>amount</dt><dd>${amount}</dd>
        <dt>currency</dt><dd>${currency}</dd>
        <dt>status</dt><dd>${status}</dd>
      </dl>
      <div class="actions">
        ${actions}
      </div>
      <p class="token-note">Secure token verified for this DummyPay session.</p>
    </main>
  </body>
</html>`;
    }

    private renderResolveConfirmationHtml(params: {
        message: string;
        status: PurchaseStatus;
        purchaseId: string;
    }) {
        const message = this.escapeHtml(params.message);
        const status = this.escapeHtml(params.status);
        const purchaseId = this.escapeHtml(params.purchaseId);

        return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MemoTrip DummyPay</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f6f7fb; color: #1f2937; margin: 0; padding: 32px 16px; }
      .card { max-width: 560px; margin: 0 auto; background: white; border-radius: 16px; padding: 24px; box-shadow: 0 10px 35px rgba(15, 23, 42, 0.08); }
      h1 { margin-top: 0; font-size: 28px; }
      p { line-height: 1.5; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>${message}</h1>
      <p>purchaseId: <strong>${purchaseId}</strong></p>
      <p>Current status: <strong>${status}</strong></p>
      <p>You can return to MemoTrip.</p>
    </main>
  </body>
</html>`;
    }

    private async getVerifiedDummyPurchase(
        purchaseId: string,
        token: string | undefined,
        select?: Record<string, boolean | object>,
    ) {
        this.assertDummyPayEnabled();

        const purchase = await this.prisma.purchase.findFirst({
            where: {
                id: purchaseId,
                provider: PurchaseProvider.DUMMY_PAY,
            },
            select: {
                id: true,
                userId: true,
                plan: true,
                provider: true,
                status: true,
                amount: true,
                currency: true,
                accessTokenHash: true,
                ...(select ?? {}),
            },
        });

        if (!purchase || !this.tokenMatchesHash(token, purchase.accessTokenHash)) {
            throw new NotFoundException('DummyPay purchase not found');
        }

        return purchase;
    }

    async createDummyPayment(userId: string, plan: PurchasePlan) {
        this.assertDummyPayEnabled();

        const price = DUMMY_PAY_PRICES[plan];
        const token = this.createOpaqueToken();
        const accessTokenHash = this.createTokenHash(token);

        const purchase = await this.prisma.purchase.create({
            data: {
                userId,
                plan,
                provider: PurchaseProvider.DUMMY_PAY,
                status: PurchaseStatus.PENDING,
                amount: price.amount,
                currency: price.currency,
                providerReference: null,
                accessTokenHash,
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

        const paymentUrl =
            `${this.getPublicBaseUrl()}/payments/dummy/${purchase.id}` +
            `?token=${encodeURIComponent(token)}`;

        return {
            purchaseId: purchase.id,
            provider: purchase.provider,
            status: purchase.status,
            plan: purchase.plan,
            amount: this.formatAmount(purchase.amount),
            currency: purchase.currency,
            paymentUrl,
        };
    }

    async renderDummyPaymentPage(purchaseId: string, token: string | undefined) {
        const purchase = await this.getVerifiedDummyPurchase(purchaseId, token);

        return this.renderDummyPayHtml({
            purchaseId: purchase.id,
            plan: purchase.plan,
            amount: this.formatAmount(purchase.amount),
            currency: purchase.currency,
            status: purchase.status,
            token: token!,
        });
    }

    async resolveDummyPayment(
        purchaseId: string,
        token: string | undefined,
        result: ResolveDummyPaymentResult,
    ) {
        const purchase = await this.getVerifiedDummyPurchase(purchaseId, token);

        if (purchase.status !== PurchaseStatus.PENDING) {
            return this.renderResolveConfirmationHtml({
                message:
                    purchase.status === PurchaseStatus.COMPLETED
                        ? 'Payment approved'
                        : 'Payment refused',
                status: purchase.status,
                purchaseId: purchase.id,
            });
        }

        const now = new Date();
        const targetStatus =
            result === ResolveDummyPaymentResult.APPROVED
                ? PurchaseStatus.COMPLETED
                : PurchaseStatus.FAILED;

        const finalStatus = await this.prisma.$transaction(async (tx) => {
            const updated = await tx.purchase.updateMany({
                where: {
                    id: purchase.id,
                    status: PurchaseStatus.PENDING,
                },
                data: {
                    status: targetStatus,
                    resolvedAt: now,
                },
            });

            if (updated.count === 0) {
                const current = await tx.purchase.findUnique({
                    where: { id: purchase.id },
                    select: { status: true },
                });

                return current?.status ?? targetStatus;
            }

            if (result === ResolveDummyPaymentResult.APPROVED) {
                await tx.user.update({
                    where: { id: purchase.userId },
                    data:
                        purchase.plan === PurchasePlan.PREMIUM
                            ? {
                                isPremium: true,
                                isKroniq: false,
                            }
                            : {
                                isPremium: false,
                                isKroniq: true,
                            },
                });
            }

            return targetStatus;
        });

        return this.renderResolveConfirmationHtml({
            message:
                finalStatus === PurchaseStatus.COMPLETED
                    ? 'Payment approved'
                    : 'Payment refused',
            status: finalStatus,
            purchaseId: purchase.id,
        });
    }
}
