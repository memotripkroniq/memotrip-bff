import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { TripChecklistItemDto } from "./trip-checklist-item.dto";
import { TripNoteDto } from "./trip-note.dto";
import { TripTipAndTripDto } from "./trip-tip-and-trip.dto";

export class TripDetailResponseDto {
    @ApiProperty()
    id: string;

    @ApiPropertyOptional({ type: String, nullable: true })
    coverImageUrl: string | null;

    @ApiPropertyOptional({ type: String, nullable: true })
    mapImageUrl: string | null;

    @ApiPropertyOptional({ type: String, nullable: true })
    mapImageFullUrl: string | null;

    @ApiProperty()
    ownerId: string;

    @ApiProperty()
    name: string;

    @ApiProperty()
    destination: string;

    @ApiProperty()
    transport: string;

    @ApiProperty()
    from: string;

    @ApiProperty()
    to: string;

    @ApiProperty({ type: String, isArray: true })
    waypoints: string[];

    @ApiProperty()
    startDate: string;

    @ApiProperty()
    endDate: string;

    @ApiPropertyOptional({ type: String, nullable: true })
    theme: string | null;

    @ApiPropertyOptional({ type: String, nullable: true })
    plannedBudget: string | null;

    @ApiPropertyOptional({ type: String, nullable: true })
    spentBudget: string | null;

    @ApiProperty()
    isSharedInKroniQ: boolean;

    @ApiProperty()
    createdAt: string;

    @ApiProperty({ type: TripChecklistItemDto, isArray: true })
    TripChecklistItems: TripChecklistItemDto[];

    @ApiProperty({ type: TripNoteDto, isArray: true })
    TripNotes: TripNoteDto[];

    @ApiProperty({ type: TripTipAndTripDto, isArray: true })
    TripTipsAndTrips: TripTipAndTripDto[];
}
