import {
    IsArray,
    IsEnum,
    IsOptional,
    IsString,
    MaxLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
    DestinationType,
    TripTheme,
    TransportType,
} from "./trip.enums";

export class CreateTripDto {

    @ApiProperty({
        example: "Summer Europe Roadtrip",
    })
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
    @IsString()
    dateFrom!: string;

    @ApiProperty({
        example: "2026-07-14",
        description: "ISO date (YYYY-MM-DD)",
    })
    @IsString()
    dateTo!: string;

    @ApiProperty({
        example: "Bratislava",
    })
    @IsString()
    from!: string;

    @ApiProperty({
        example: "Barcelona",
    })
    @IsString()
    to!: string;

    @ApiPropertyOptional({
        example: ["Vienna", "Venice"],
        maxItems: 3,
    })
    @IsOptional()
    @IsArray()
    @MaxLength(3, { each: true })
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
}
