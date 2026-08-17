import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export enum ResolveDummyPaymentResult {
    APPROVED = 'APPROVED',
    REFUSED = 'REFUSED',
}

export class ResolveDummyPaymentDto {
    @ApiProperty({
        enum: ResolveDummyPaymentResult,
        enumName: 'ResolveDummyPaymentResult',
        example: ResolveDummyPaymentResult.APPROVED,
    })
    @IsEnum(ResolveDummyPaymentResult)
    result: ResolveDummyPaymentResult;
}
