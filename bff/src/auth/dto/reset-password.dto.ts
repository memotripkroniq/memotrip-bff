import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
    @ApiProperty({
        example: 'c8d2478f-8b4a-4a12-9bc4-25815fe20f45',
        description: 'Password reset token from the email link',
    })
    @IsString()
    token: string;

    @ApiProperty({
        example: 'NewPassword123!',
        description: 'New password to set for the account',
    })
    @IsString()
    @MinLength(6)
    newPassword: string;
}
