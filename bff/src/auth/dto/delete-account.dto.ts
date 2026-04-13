import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class DeleteAccountDto {
    @ApiPropertyOptional({
        example: 'userPassword123',
        description: 'Required for password-based accounts.',
    })
    @IsOptional()
    @IsString()
    @MinLength(6)
    currentPassword?: string;

    @ApiPropertyOptional({
        example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...',
        description: 'Fresh Google ID token required for Google-only accounts.',
    })
    @IsOptional()
    @IsString()
    googleIdToken?: string;
}
