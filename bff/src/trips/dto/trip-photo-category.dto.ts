import { ApiProperty } from "@nestjs/swagger";

export class TripPhotoCategoryDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    name: string;
}
