import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordResponseDto {
    @ApiProperty()
    success: boolean;

    @ApiProperty()
    hasPassword: boolean;
}
