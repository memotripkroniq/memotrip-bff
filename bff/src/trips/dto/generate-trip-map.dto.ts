import {IsArray, IsEnum, IsOptional, IsString} from "class-validator";

export enum TransportType {
    CAR = "CAR",
    CARAVAN = "CARAVAN",
    CAMPER = "CAMPER",
    MOTORCYCLE = "MOTORCYCLE",
    BIKE = "BIKE",
    WALK = "WALK",
    TRAIN = "TRAIN",
    PLANE = "PLANE",
    SHIP = "SHIP"
}

export class GenerateTripMapDto {
    @IsString()
    from!: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    stops?: string[]; // 🆕 WAYPOINTS

    @IsString()
    to!: string;

    @IsArray()
    @IsEnum(TransportType, { each: true })
    transports!: TransportType[];
}
