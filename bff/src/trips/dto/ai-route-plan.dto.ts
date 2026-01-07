import { IsArray, IsEnum, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { TransportType } from "./generate-trip-map.dto";

export class AiRouteSegmentDto {
    @IsString()
    from!: string;

    @IsString()
    to!: string;

    @IsEnum(TransportType)
    transport!: TransportType;
}

export class AiRoutePlanDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => AiRouteSegmentDto)
    segments!: AiRouteSegmentDto[];
}