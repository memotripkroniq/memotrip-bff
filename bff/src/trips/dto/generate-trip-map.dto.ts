import { IsArray, IsString } from "class-validator";

export class GenerateTripMapDto {
    @IsString()
    from!: string;

    @IsString()
    to!: string;

    @IsArray()
    transports!: string[]; // ["CAR", "CARAVAN"] ...
}
