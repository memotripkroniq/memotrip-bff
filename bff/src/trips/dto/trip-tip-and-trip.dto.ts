import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class TripTipAndTripDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    title: string;

    @ApiPropertyOptional({ type: String, nullable: true })
    imageUrl: string | null;

    @ApiProperty()
    order: number;
}
