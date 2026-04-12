import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

export class UpdateTripPhotoCategoryDto {
    @ApiProperty({
        example: "Beach",
    })
    @IsString()
    @MinLength(1)
    name: string;
}
