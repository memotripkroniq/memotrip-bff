import { ApiPropertyOptional } from '@nestjs/swagger';
import { DummyPaymentStatusResponseDto } from './dummy-payment-status-response.dto';

export class ContinueDummyPaymentResponseDto extends DummyPaymentStatusResponseDto {
    @ApiPropertyOptional({ description: 'Sensitive payment URL. Only present for PENDING. Replaces all previously issued URLs; never persist or log it.' })
    paymentUrl?: string;
}
