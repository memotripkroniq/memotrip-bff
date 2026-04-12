import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class TripPhotoDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    imageUrl: string;

    @ApiProperty()
    thumbnailUrl: string;

    @ApiProperty()
    categoryId: string;

    @ApiProperty()
    order: number;

    @ApiProperty()
    createdAt: string;
}
