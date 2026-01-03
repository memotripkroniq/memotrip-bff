import {
    Injectable,
    BadRequestException,
    UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { RegisterDto } from './dto/register.dto';
import { JwtService } from '@nestjs/jwt';

// 🔥 DŮLEŽITÉ – musíš importovat LoginTicket
import { OAuth2Client, LoginTicket } from 'google-auth-library';

import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
    private googleClient: OAuth2Client;

    constructor(
        private readonly prisma: PrismaService,
        private readonly usersService: UsersService,
        private readonly jwtService: JwtService,
    ) {
        // Tady necháváme původní web client ID,
        // audience můžeme override přímo v verifyIdToken
        this.googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    }

    // ======================
    // REGISTER
    // ======================
    async register(data: RegisterDto) {
        const { email, password } = data;

        const existing = await this.prisma.user.findUnique({
            where: { email },
        });

        if (existing) {
            throw new BadRequestException('Email already exists');
        }

        const hashed = await bcrypt.hash(password, 10);

        const user = await this.prisma.user.create({
            data: {
                email,
                passwordhash: hashed,
            },
        });

        return this.generateToken(user.id, user.email);
    }

    // ======================
    // LOGIN
    // ======================
    async login(email: string, password: string) {
        const cleanEmail = email.trim().toLowerCase();

        // 1) Najdu uživatele
        const user = await this.prisma.user.findUnique({
            where: { email: cleanEmail }
        });

        // 2) Email neexistuje
        if (!user) {
            throw new UnauthorizedException({
                error: "EMAIL_NOT_FOUND",
                message: "You must be registered"
            });
        }

        // 3) Google-only účet (bez hesla)
        if (!user.passwordhash) {
            throw new UnauthorizedException({
                error: "NO_PASSWORD_USE_GOOGLE",
                message: "This account uses Google login"
            });
        }

        // 4) Heslo je špatně
        const isValid = await bcrypt.compare(password, user.passwordhash);
        if (!isValid) {
            throw new UnauthorizedException({
                error: "WRONG_PASSWORD",
                message: "Incorrect password"
            });
        }

        // 5) OK – generujeme token
        const token = this.jwtService.sign({
            sub: user.id,
            email: user.email
        });

        return { access_token: token };
    }


    // ======================
    // JWT TOKEN
    // ======================
    private generateToken(id: string, email: string) {
        const payload = { sub: id, email };
        return { access_token: this.jwtService.sign(payload) };
    }

    // ======================
    // GOOGLE LOGIN
    // ======================
    async googleLogin(idToken: string) {
        try {
            const androidClientId = process.env.GOOGLE_ANDROID_CLIENT_ID;

            if (!androidClientId) {
                throw new Error("GOOGLE_ANDROID_CLIENT_ID is missing");
            }

            // 🔑 Ověřujeme POUZE proti ANDROID client ID
            const ticket = await this.googleClient.verifyIdToken({
                idToken,
                audience: androidClientId,
            });

            const payload = ticket.getPayload();

            if (!payload || !payload.email || !payload.sub) {
                throw new UnauthorizedException("INVALID_GOOGLE_PAYLOAD");
            }

            const email = payload.email;
            const googleUserId = payload.sub;
            const name = payload.name ?? "Google User";

            let user = await this.prisma.user.findUnique({
                where: { email },
            });

            if (!user) {
                user = await this.prisma.user.create({
                    data: {
                        email,
                        name,
                        provider: "GOOGLE",
                        providerId: googleUserId,
                        passwordhash: null,
                    },
                });
            }

            const accessToken = this.jwtService.sign(
                { sub: user.id },
                { expiresIn: "15m" }
            );

            const refreshToken = this.jwtService.sign(
                { sub: user.id },
                { expiresIn: "30d" }
            );

            return { accessToken, refreshToken };

        } catch (e) {
            console.error("❌ GOOGLE LOGIN ERROR:", e);
            throw new UnauthorizedException("GOOGLE_401");
        }
    }




    // ======================
    // GET ME (CURRENT USER)
    // ======================
    async getMe(userId: string) {
        console.log('🔍 GET ME userId:', userId);
        
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                isPremium: true,
                isKroniq: true,
            },
        });

        console.log('👤 USER FROM DB:', user);

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        return {
            id: user.id,
            email: user.email,
            name: user.name,
            isPremium: user.isPremium,
            isKroniq: user.isKroniq,
        };
    }



}
