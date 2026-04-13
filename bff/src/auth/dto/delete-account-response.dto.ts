import { ApiProperty } from '@nestjs/swagger';

export class DeleteAccountResponseDto {
    @ApiProperty()
    success: boolean;
}
