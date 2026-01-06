import {IsArray, IsOptional, IsString} from "class-validator";

export class GenerateTripMapDto {
    @IsString()
    from!: string;

    @IsString()
    to!: string;

    @IsArray()
    transports!: string[]; // ["CAR", "CARAVAN"] ...

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    stops?: string[]; // 🆕 WAYPOINTS
}
