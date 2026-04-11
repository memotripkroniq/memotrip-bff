import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class MeResponseDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    email: string;

    @ApiPropertyOptional({ type: String, nullable: true })
    name: string | null;

    @ApiPropertyOptional({ type: String, nullable: true })
    firstName: string | null;

    @ApiPropertyOptional({ type: String, nullable: true })
    lastName: string | null;

    @ApiPropertyOptional({ type: String, nullable: true })
    gender: string | null;

    @ApiPropertyOptional({
        type: String,
        nullable: true,
        description: "Date-only format YYYY-MM-DD.",
        example: "1994-04-10",
    })
    dateOfBirth: string | null;

    @ApiPropertyOptional({ type: String, nullable: true })
    profileImageUrl: string | null;

    @ApiProperty()
    isPremium: boolean;

    @ApiProperty()
    isKroniq: boolean;

    @ApiProperty()
    hasPassword: boolean;
}
