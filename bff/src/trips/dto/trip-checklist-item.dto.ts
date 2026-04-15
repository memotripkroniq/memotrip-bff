import { ApiProperty } from "@nestjs/swagger";

export class TripChecklistItemDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    text: string;

    @ApiProperty()
    checked: boolean;

    @ApiProperty()
    order: number;
}
