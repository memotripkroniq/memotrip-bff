import { Prisma } from '@prisma/client';

export const userResponseSelect = {
    id: true,
    email: true,
    name: true,
    country: true,
} satisfies Prisma.UserSelect;

export class UserResponseDto {
    id: string;
    email: string;
    name: string | null;
    country: string;

    static from(user: UserResponseDto): UserResponseDto {
        return { id: user.id, email: user.email, name: user.name, country: user.country };
    }
}
