import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KroniqMemberDto } from './kroniq-member.dto';

export class KroniqMeResponseDto {
    @ApiPropertyOptional({ type: String, nullable: true })
    kroniqImageUrl: string | null;

    @ApiProperty({ type: KroniqMemberDto, isArray: true })
    members: KroniqMemberDto[];
}
