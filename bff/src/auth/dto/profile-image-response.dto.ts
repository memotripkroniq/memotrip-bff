import { ApiPropertyOptional } from "@nestjs/swagger";

export class ProfileImageResponseDto {
    @ApiPropertyOptional({ type: String, nullable: true })
    profileImageUrl: string | null;
}
