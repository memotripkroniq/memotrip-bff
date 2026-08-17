import { PurchasePlan, PurchaseProvider, PurchaseStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDummyPaymentResponseDto {
    @ApiProperty()
    purchaseId: string;

    @ApiProperty({
        enum: PurchaseProvider,
        enumName: 'PurchaseProvider',
        example: PurchaseProvider.DUMMY_PAY,
    })
    provider: PurchaseProvider;

    @ApiProperty({
        enum: PurchaseStatus,
        enumName: 'PurchaseStatus',
        example: PurchaseStatus.PENDING,
    })
    status: PurchaseStatus;

    @ApiProperty({
        enum: PurchasePlan,
        enumName: 'PurchasePlan',
        example: PurchasePlan.PREMIUM,
    })
    plan: PurchasePlan;

    @ApiProperty({ example: '5.99' })
    amount: string;

    @ApiProperty({ example: 'EUR' })
    currency: string;

    @ApiProperty({
        example: 'http://localhost:3000/payments/dummy/uuid?token=opaque-token',
    })
    paymentUrl: string;
}
