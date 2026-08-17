import { PurchasePlan } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export class CreateDummyPaymentDto {
    @ApiProperty({
        enum: PurchasePlan,
        enumName: 'PurchasePlan',
        example: PurchasePlan.PREMIUM,
    })
    @IsEnum(PurchasePlan)
    plan: PurchasePlan;
}
