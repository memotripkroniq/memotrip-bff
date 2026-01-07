import { IsIn, IsNumber, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class PointDto {
    @IsNumber()
    lat!: number;

    @IsNumber()
    lon!: number;
}

export class RouteSegmentDto {
    @ValidateNested()
    @Type(() => PointDto)
    from!: PointDto;

    @ValidateNested()
    @Type(() => PointDto)
    to!: PointDto;

    @IsIn(["PLANE", "CAR", "CAMPER", "CARAVAN", "MOTORCYCLE", "BIKE", "WALK", "SHIP", "TRAIN"])
    transport!: string;
}

export class RenderTripMapDto {
    @ValidateNested({ each: true })
    @Type(() => RouteSegmentDto)
    segments!: RouteSegmentDto[];
}

