import { ApiProperty } from '@nestjs/swagger';
import { KroniqMemberDto } from './kroniq-member.dto';

export class AddKroniqMemberResponseDto {
    @ApiProperty()
    success: boolean;

    @ApiProperty({ type: KroniqMemberDto })
    member: KroniqMemberDto;
}
