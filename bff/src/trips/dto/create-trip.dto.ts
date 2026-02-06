import {
    IsArray,
    IsDateString,
    IsEnum,
    IsOptional,
    IsString,
    ArrayMaxSize,
    IsUrl,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
    DestinationType,
    TripTheme,
    TransportType,
} from "./trip.enums";

export class CreateTripDto {

    @ApiProperty({ example: "Summer Europe Roadtrip" })
    @IsString()
    name!: string;

    @ApiProperty({
        enum: DestinationType,
        example: DestinationType.EUROPE,
    })
    @IsEnum(DestinationType)
    destination!: DestinationType;

    @ApiProperty({
        example: "2026-07-01",
        description: "ISO date (YYYY-MM-DD)",
    })
    @IsDateString()
    dateFrom!: string;

    @ApiProperty({
        example: "2026-07-14",
        description: "ISO date (YYYY-MM-DD)",
    })
    @IsDateString()
    dateTo!: string;

    @ApiProperty({ example: "Bratislava" })
    @IsString()
    from!: string;

    @ApiProperty({ example: "Barcelona" })
    @IsString()
    to!: string;

    @ApiPropertyOptional({
        example: ["Vienna", "Venice"],
        maxItems: 3,
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(3)
    @IsString({ each: true })
    waypoints?: string[];

    @ApiPropertyOptional({
        enum: TripTheme,
        example: TripTheme.SUMMER,
    })
    @IsOptional()
    @IsEnum(TripTheme)
    theme?: TripTheme;

    @ApiProperty({
        enum: TransportType,
        example: TransportType.CARAVAN,
    })
    @IsEnum(TransportType)
    transport!: TransportType;

    @ApiPropertyOptional({
        example: "https://cdn.memotrip.app/trips/covers/abc123.jpg",
        description: "Optional URL of uploaded cover image",
    })
    @IsOptional()
    @IsString()
    @IsUrl()
    coverImageUrl?: string;

    @ApiProperty({
        example: "https://cdn.memotrip.app/trips/maps/xyz987.webp",
        description: "Required URL of generated map image",
    })
    @IsUrl()
    mapImageUrl!: string;
}
