import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TripLimitResponseDto {
    @ApiProperty()
    allowed: boolean;

    @ApiProperty({
        enum: ['TRIP_LIMIT_OK', 'TRIP_LIMIT_REACHED'],
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

    @ApiProperty()
    windowDays: number;

    @ApiProperty({
        description: 'UTC start of the current trip limit window',
    })
    windowStart: Date;
}
