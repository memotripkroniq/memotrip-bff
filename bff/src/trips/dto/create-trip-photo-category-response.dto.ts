import { ApiProperty } from "@nestjs/swagger";
import { TripPhotoCategoryDto } from "./trip-photo-category.dto";

export class CreateTripPhotoCategoryResponseDto {
    @ApiProperty({ type: TripPhotoCategoryDto })
    category: TripPhotoCategoryDto;
}
