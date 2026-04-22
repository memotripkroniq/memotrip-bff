import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class TripPhotoLimitResponseDto {
    @ApiProperty()
    allowed: boolean;

    @ApiProperty({
        enum: ['TRIP_PHOTO_LIMIT_OK', 'TRIP_PHOTO_LIMIT_REACHED'],
    })
    code: string;

    @ApiProperty({
        enum: ['free', 'premium', 'kroniq'],
    })
    plan: string;

    @ApiProperty()
    used: number;

    @ApiPropertyOptional({
        nullable: true,
        description: 'Null means unlimited for the current plan',
    })
    limit: number | null;
}
