import {
    IsArray,
    IsEnum,
    IsOptional,
    IsString,
    MaxLength,
} from "class-validator";
import {
    DestinationType,
    TripTheme,
    TransportType,
} from "./trip.enums";

export class CreateTripDto {
    // 🏷️ Název tripu
    @IsString()
    name!: string;

    // 🌍 Destination (continent)
    @IsEnum(DestinationType)
    destination!: DestinationType;

    // 📅 Datum od
    @IsString()
    dateFrom!: string; // ISO string

    // 📅 Datum do
    @IsString()
    dateTo!: string; // ISO string

    // 📍 Start
    @IsString()
    from!: string;

    // 📍 Cíl
    @IsString()
    to!: string;

    // ➕ Waypoints (max 3)
    @IsOptional()
    @IsArray()
    @MaxLength(3, { each: true })
    waypoints?: string[];

    // 🎨 Theme (optional)
    @IsOptional()
    @IsEnum(TripTheme)
    theme?: TripTheme;

    // 🚗 Transport
    @IsEnum(TransportType)
    transport!: TransportType;
}
