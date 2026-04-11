import { ApiPropertyOptional } from '@nestjs/swagger';

export class KroniqImageResponseDto {
    @ApiPropertyOptional({ type: String, nullable: true })
    kroniqImageUrl: string | null;
}
