import { ApiProperty } from "@nestjs/swagger";

export class TripNoteDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    text: string;

    @ApiProperty()
    order: number;
}
