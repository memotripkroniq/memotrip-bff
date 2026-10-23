import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { UserResponseDto, userResponseSelect } from './dto/user-response.dto';

@Injectable()
export class UsersService {
    constructor(private prisma: PrismaService) {}

    async createUser(data: { email: string; password: string; name: string; country: string }) {
        const hashedPassword = await bcrypt.hash(data.password, 10);
        const user = await this.prisma.user.create({
            data: {
                email: data.email,
                passwordhash: hashedPassword,
                name: data.name,
                country: data.country,
            },
            select: userResponseSelect,
        });
        return UserResponseDto.from(user);
    }

    // Preserve the legacy array shape without exposing other accounts.
    async findAll(userId: string) {
        if (!userId || typeof userId !== 'string') {
            throw new UnauthorizedException();
        }
        const users = await this.prisma.user.findMany({
            where: { id: userId, deletedAt: null },
            select: userResponseSelect,
        });
        return users.map(UserResponseDto.from);
    }

    async validateUser(email: string, password: string) {
        const user = await this.prisma.user.findFirst({
            where: { email, deletedAt: null },
            select: { ...userResponseSelect, passwordhash: true },
        });
        if (!user?.passwordhash) return null;
        const isPasswordValid = await bcrypt.compare(password, user.passwordhash);
        return isPasswordValid ? UserResponseDto.from(user) : null;
    }
}
