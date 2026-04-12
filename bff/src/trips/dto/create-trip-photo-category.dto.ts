import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

export class CreateTripPhotoCategoryDto {
    @ApiProperty({
        example: "Trip to beach",
    })
    @IsString()
    @MinLength(1)
    name: string;
}
