import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshTokenDto {
    // Shape-valid but unknown tokens (including legacy JWTs) receive a generic 401.
    @ApiProperty({ description: 'Current opaque MemoTrip refresh token; not a Google token.' })
    @IsString()
    @MinLength(1)
    @MaxLength(4096)
    refreshToken: string;
}
