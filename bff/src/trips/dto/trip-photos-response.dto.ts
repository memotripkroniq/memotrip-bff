import { ApiProperty } from "@nestjs/swagger";
import { TripPhotoCategoryDto } from "./trip-photo-category.dto";
import { TripPhotoDto } from "./trip-photo.dto";

export class TripPhotosResponseDto {
    @ApiProperty({ type: TripPhotoCategoryDto, isArray: true })
    categories: TripPhotoCategoryDto[];

    @ApiProperty({ type: TripPhotoDto, isArray: true })
    photos: TripPhotoDto[];
}
