import { ApiProperty } from '@nestjs/swagger';
import { KroniqImageResponseDto } from './kroniq-image-response.dto';

export class DeleteKroniqImageResponseDto extends KroniqImageResponseDto {
    @ApiProperty()
    success: boolean;
}
