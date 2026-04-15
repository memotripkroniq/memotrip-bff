import { ApiProperty } from "@nestjs/swagger";

export class TripKroniqShareResponseDto {
    @ApiProperty()
    success: boolean;

    @ApiProperty()
    isSharedInKroniQ: boolean;
}
