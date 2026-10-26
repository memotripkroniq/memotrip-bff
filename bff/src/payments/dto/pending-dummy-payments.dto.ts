import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { DummyPaymentStatusResponseDto } from './dummy-payment-status-response.dto';

export class PendingDummyPaymentsQueryDto {
    @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    limit: number = 20;

    @ApiPropertyOptional({ format: 'uuid', description: 'nextCursor from the preceding page. Stable descending purchaseId order, not chronological order.' })
    @IsOptional()
    @IsUUID()
    cursor?: string;
}

export class PendingDummyPaymentDto extends DummyPaymentStatusResponseDto {
    @ApiProperty({ type: String, format: 'date-time' })
    createdAt: Date;
}

export class PendingDummyPaymentsResponseDto {
    @ApiProperty({ type: [PendingDummyPaymentDto] })
    items: PendingDummyPaymentDto[];

    @ApiProperty({ type: String, format: 'uuid', nullable: true })
    nextCursor: string | null;
}
