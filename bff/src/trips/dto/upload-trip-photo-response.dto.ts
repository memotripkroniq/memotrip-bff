import { ApiProperty } from "@nestjs/swagger";
import { TripPhotoDto } from "./trip-photo.dto";

export class UploadTripPhotoResponseDto {
    @ApiProperty({ type: TripPhotoDto })
    photo: TripPhotoDto;
}
