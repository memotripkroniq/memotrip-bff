import { ApiProperty } from '@nestjs/swagger';
import { PurchasePlan, PurchaseProvider, PurchaseStatus } from '@prisma/client';

export class DummyPaymentStatusResponseDto {
    @ApiProperty({ format: 'uuid' })
    purchaseId: string;

    @ApiProperty({ enum: [PurchaseProvider.DUMMY_PAY] })
    provider: PurchaseProvider;

    @ApiProperty({ enum: PurchaseStatus, enumName: 'PurchaseStatus' })
    status: PurchaseStatus;

    @ApiProperty({ enum: PurchasePlan, enumName: 'PurchasePlan' })
    plan: PurchasePlan;
}
