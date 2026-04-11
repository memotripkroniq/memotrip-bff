import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class KroniqMemberDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    email: string;

    @ApiPropertyOptional({ type: String, nullable: true })
    name: string | null;

    @ApiProperty()
    role: string;

    @ApiPropertyOptional({ type: String, nullable: true })
    profileImageUrl: string | null;
}
