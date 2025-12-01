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
        const user = await this.usersService.validateUser(email, password);

        if (!user) {
            const exists = await this.usersService.findUserByEmail(email);
            if (exists && !exists.passwordhash) {
                throw new UnauthorizedException("NO_PASSWORD_USE_GOOGLE");
            }
            throw new UnauthorizedException("WRONG_PASSWORD");
        }

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
            console.log("🔥 GOOGLE LOGIN: idToken received:", idToken.substring(0, 15) + "...");

            // ⭐ ZDE JE OPRAVENÉ AUDIENCE (Android + Web)
            const ticket: LoginTicket = await this.googleClient.verifyIdToken({
                idToken,
                audience: [
                    process.env.GOOGLE_ANDROID_CLIENT_ID!,
                    process.env.GOOGLE_CLIENT_ID!,
                ],
            });

            console.log("🔥 GOOGLE LOGIN: Token verified successfully");

            const payload = ticket.getPayload();
            console.log("🔥 GOOGLE LOGIN PAYLOAD:", payload);

            if (!payload || !payload.email) {
                console.error("❌ Google payload missing email");
                throw new UnauthorizedException("Google login did not return an email");
            }

            const email = payload.email;
            const name = payload.name ?? "Google User";
            const googleUserId = payload.sub;

            let user = await this.prisma.user.findUnique({
                where: { email },
            });

            if (!user) {
                console.log("🔥 GOOGLE LOGIN: Creating new user");

                user = await this.prisma.user.create({
                    data: {
                        email,
                        name,
                        passwordhash: null,
                        provider: 'GOOGLE',
                        providerId: googleUserId,
                    },
                });
            } else {
                console.log("🔥 GOOGLE LOGIN: User already exists, logging in");
            }

            const accessToken = this.jwtService.sign(
                { userId: user.id },
                { expiresIn: '15m' }
            );

            const refreshToken = this.jwtService.sign(
                { userId: user.id },
                { expiresIn: '30d' }
            );

            console.log("🔥 GOOGLE LOGIN: Tokens generated");

            return {
                accessToken,
                refreshToken,
            };

        } catch (e) {
            console.error("❌ GOOGLE LOGIN ERROR:", e);
            throw new UnauthorizedException("Invalid Google token");
        }
    }

}
