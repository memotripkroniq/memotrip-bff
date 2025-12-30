import { IsIn, IsNumber, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class PointDto {
    @IsNumber()
    lat!: number;

    @IsNumber()
    lon!: number;
}

export class RenderTripMapDto {
    @ValidateNested()
    @Type(() => PointDto)
    from!: PointDto;

    @ValidateNested()
    @Type(() => PointDto)
    to!: PointDto;

    @IsIn(["CAR", "CARAVAN", "BOAT"])
    transport!: string;
}
