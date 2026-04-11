import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
    @ApiPropertyOptional({
        example: 'oldPassword123',
        description: 'Required when the account already has a password.',
    })
    @IsOptional()
    @IsString()
    currentPassword?: string;

    @ApiProperty({
        example: 'newPassword123',
        description: 'Minimum length is 6 characters.',
    })
    @IsString()
    @MinLength(6)
    newPassword: string;
}
