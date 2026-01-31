import {
    Injectable,
    BadRequestException,
    UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { RegisterDto } from './dto/register.dto';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
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

        //return this.generateToken(user.id, user.email);
        return {
            accessToken: this.jwtService.sign({ sub: user.id, email: user.email }),
        };
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

        //return { access_token: token };
        return {
            accessToken: this.jwtService.sign({
                sub: user.id,
                email: user.email,
            }),
        };
    }


    //// ======================
    //// JWT TOKEN - SMAZAT
    //// ======================
    //private generateToken(id: string, email: string) {
    //    const payload = { sub: id, email };
    //    return { access_token: this.jwtService.sign(payload) };
    //}

    // ======================
    // GOOGLE LOGIN
    // ======================
    async googleLogin(idToken: string) {
        try {
            console.log("🔥 GOOGLE LOGIN: idToken received:", idToken.substring(0, 15) + "...");

            // =====================
            // ENV DEBUG LOGY
            // =====================
            console.log("🌍 GOOGLE_CLIENT_ID =", process.env.GOOGLE_CLIENT_ID);
            console.log("🤖 GOOGLE_ANDROID_CLIENT_ID =", process.env.GOOGLE_ANDROID_CLIENT_ID);

            const audienceList = [
                process.env.GOOGLE_ANDROID_CLIENT_ID,
                process.env.GOOGLE_CLIENT_ID,
            ];

            console.log("🎯 AUDIENCE SENT TO GOOGLE:", audienceList);

            // ======================
            // VERIFY TOKEN
            // ======================
            const ticket = await this.googleClient.verifyIdToken({
                idToken,
                audience: undefined, // vypnuto pro debug
            });

            console.log("🔥 GOOGLE LOGIN: Token OK, raw:", ticket);

            // payload získáme TADY
            // @ts-ignore — Google Auth má špatné typy
            const payload = ticket.getPayload();

            console.log("🔍 PAYLOAD AZP:", payload?.azp);
            console.log("🔍 PAYLOAD AUD:", payload?.aud);
            console.log(
                "🔍 EXPECTED:",
                process.env.GOOGLE_ANDROID_CLIENT_ID,
                process.env.GOOGLE_CLIENT_ID
            );

            console.log("📦 GOOGLE LOGIN PAYLOAD:", payload);


            // =====================
            // VALIDACE
            // =====================
            if (!payload) {
                console.error("❌ NO PAYLOAD RETURNED FROM GOOGLE");
                throw new UnauthorizedException("NO_PAYLOAD");
            }

            if (!payload.email) {
                console.error("❌ PAYLOAD HAS NO EMAIL");
                throw new UnauthorizedException("NO_EMAIL");
            }

            console.log("📧 EMAIL:", payload.email);
            console.log("🆔 GOOGLE SUB:", payload.sub);
            console.log("👤 NAME:", payload.name);

            const email = payload.email;
            const googleUserId = payload.sub;
            const name = payload.name ?? "Google User";

            // =====================
            // UŽIVATEL V DATABÁZI
            // =====================
            console.log("🔎 Checking if user exists in DB…");

            let user = await this.prisma.user.findUnique({ where: { email } });

            if (!user) {
                console.log("🆕 User not found → creating");

                user = await this.prisma.user.create({
                    data: {
                        email,
                        name,
                        provider: "GOOGLE",
                        providerId: googleUserId,
                        passwordhash: null,
                    },
                });
            } else {
                console.log("👋 User exists, logging in");
            }

            console.log("🧪 DB User:", user);

            // =====================
            // GENERATE TOKENS
            // =====================
            const accessToken = this.jwtService.sign(
                { sub: user.id },
                { expiresIn: "15m" }
            );

            const refreshToken = this.jwtService.sign(
                { sub: user.id },
                { expiresIn: "30d" }
            );

            console.log("🎫 TOKENS CREATED OK");

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

    // ======================
    // GET TRIP LIMITS (CAN CREATE TRIP?)
    // ======================
    async getTripLimits(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { isPremium: true, isKroniq: true },
        });

        const plan = user?.isKroniq ? "KRONIQ" : user?.isPremium ? "PREMIUM" : "FREE";

        const policy =
            plan === "KRONIQ"
                ? { limit: 30, windowDays: 365 }
                : plan === "PREMIUM"
                    ? { limit: 3, windowDays: 30 }
                    : { limit: 1, windowDays: 90 };

        const windowStart = new Date(
            Date.now() - policy.windowDays * 24 * 60 * 60 * 1000
        );

        const used = await this.prisma.trips.count({
            where: {
                ownerId: userId,
                createdAt: { gte: windowStart },
            },
        });

        const allowed = used < policy.limit;

        return {
            allowed,
            code: allowed ? null : "TRIP_LIMIT_REACHED",
            plan,
            used,
            limit: policy.limit,
            windowDays: policy.windowDays,
            windowStart,
        };
    }




}
