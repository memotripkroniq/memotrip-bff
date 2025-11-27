// src/users/users.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
    constructor(private prisma: PrismaService) {}

    // vytvoření uživatele
    async createUser(data: { email: string; password: string; name: string; country: string }) {
        const hashedPassword = await bcrypt.hash(data.password, 10);
        return this.prisma.user.create({
            data: {
                email: data.email,
                passwordhash: hashedPassword,  // upraveno podle modelu
                name: data.name,
                country: data.country,
            },
        });
    }

    // získání všech uživatelů
    async findAll() {
        return this.prisma.user.findMany();
    }

    // hledání uživatele podle e-mailu
    async findUserByEmail(email: string) {
        return this.prisma.user.findUnique({
            where: { email },
        });
    }

    // ověření uživatele (login)
    async validateUser(email: string, password: string) {
        const user = await this.findUserByEmail(email);
        if (!user) return null;

        // použijeme passwordhash
        const isPasswordValid = await bcrypt.compare(password, user.passwordhash);
        return isPasswordValid ? user : null;
    }
}
