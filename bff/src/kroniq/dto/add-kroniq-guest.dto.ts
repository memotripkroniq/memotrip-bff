import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class AddKroniqGuestDto {
    @ApiProperty({
        example: 'guest@example.com',
    })
    @IsEmail()
    email: string;
}
