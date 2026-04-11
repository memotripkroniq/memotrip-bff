import { ApiProperty } from '@nestjs/swagger';
import { KroniqMemberDto } from './kroniq-member.dto';

export class AddKroniqGuestResponseDto {
    @ApiProperty()
    success: boolean;

    @ApiProperty({ type: KroniqMemberDto })
    guest: KroniqMemberDto;
}
