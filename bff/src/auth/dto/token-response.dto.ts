import { ApiProperty } from '@nestjs/swagger';

export class TokenResponseDto {
    @ApiProperty() accessToken: string;
    @ApiProperty() refreshToken: string;
    @ApiProperty({ enum: ['Bearer'] }) tokenType: 'Bearer';
    @ApiProperty({ description: 'Access token lifetime in seconds, capped by session expiry.' }) expiresIn: number;
    @ApiProperty({ format: 'date-time' }) refreshTokenExpiresAt: string;
    @ApiProperty({ format: 'uuid' }) sessionId: string;
    @ApiProperty({ format: 'uuid' }) userId: string;
}
