import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateMeDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    name?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    gender?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    firstName?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    lastName?: string;

    @ApiPropertyOptional({
        example: '1994-04-10',
        description: 'Date-only format YYYY-MM-DD.',
    })
    @IsOptional()
    @IsString()
    @Matches(/^\d{4}-\d{2}-\d{2}$/, {
        message: 'dateOfBirth must be in YYYY-MM-DD format',
    })
    dateOfBirth?: string;
}
