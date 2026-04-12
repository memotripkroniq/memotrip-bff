import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class UpdateTripPhotoDto {
    @ApiProperty({
        example: "cat_2",
    })
    @IsString()
    categoryId: string;
}
