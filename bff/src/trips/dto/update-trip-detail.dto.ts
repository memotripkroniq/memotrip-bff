import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class UpdateChecklistItemDto {
    @ApiPropertyOptional() @IsString() text: string;
    @ApiPropertyOptional() @IsBoolean() checked: boolean;
    @ApiPropertyOptional() @IsInt() order: number;
}

export class UpdateNoteDto {
    @ApiPropertyOptional() @IsString() text: string;
    @ApiPropertyOptional() @IsInt() order: number;
}

export class UpdateTipAndTripDto {
    @ApiPropertyOptional() @IsString() title: string;
    @ApiPropertyOptional() @IsOptional() @IsString() imageUrl?: string | null;
    @ApiPropertyOptional() @IsInt() order: number;
}

export class UpdateTripDetailDto {
    // existující fields (pokud chceš updatovat i tyhle)
    @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() destination?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() transport?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() from?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() to?: string;
    @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) waypoints?: string[];
    @ApiPropertyOptional() @IsOptional() @IsString() startDate?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() endDate?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() theme?: string;

    @ApiPropertyOptional() @IsOptional() @IsString() coverImageUrl?: string | null;
    @ApiPropertyOptional() @IsOptional() @IsString() mapImageUrl?: string | null;
    @ApiPropertyOptional() @IsOptional() @IsString() mapImageFullUrl?: string | null;

    // ✅ NEW
    @ApiPropertyOptional() @IsOptional() @IsString() plannedBudget?: string | null;
    @ApiPropertyOptional() @IsOptional() @IsString() spentBudget?: string | null;

    @ApiPropertyOptional({ type: [UpdateChecklistItemDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => UpdateChecklistItemDto)
    checklistItems?: UpdateChecklistItemDto[];

    @ApiPropertyOptional({ type: [UpdateNoteDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => UpdateNoteDto)
    notes?: UpdateNoteDto[];

    @ApiPropertyOptional({ type: [UpdateTipAndTripDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => UpdateTipAndTripDto)
    tipsAndTrips?: UpdateTipAndTripDto[];
}