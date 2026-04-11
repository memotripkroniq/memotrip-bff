import { ApiProperty } from '@nestjs/swagger';

export class RemoveKroniqMemberResponseDto {
    @ApiProperty()
    success: boolean;
}
