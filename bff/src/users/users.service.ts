// src/users/users.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

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
        console.log("👤 VALIDATE USER:", email);

        const user = await this.findUserByEmail(email);
        console.log("🔎 USER:", user);

        if (!user) return null;

        if (!user.passwordhash) {
            console.log("⚠️ USER HAS NO PASSWORD (Google?)");
            return null;
        }

        const isPasswordValid = await bcrypt.compare(password, user.passwordhash);
        console.log("🔐 PASSWORD VALID:", isPasswordValid);

        return isPasswordValid ? user : null;
    }

}
