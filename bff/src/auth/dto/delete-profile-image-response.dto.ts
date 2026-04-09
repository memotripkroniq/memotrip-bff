import { ApiProperty } from "@nestjs/swagger";
import { ProfileImageResponseDto } from "./profile-image-response.dto";

export class DeleteProfileImageResponseDto extends ProfileImageResponseDto {
    @ApiProperty()
    success: boolean;
}
