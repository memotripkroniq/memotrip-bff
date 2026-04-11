import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { deletePublicFile, uploadUserProfilePhoto } from '../storage/r2-upload';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateMeDto } from './dto/update-me.dto';

@Injectable()
export class AuthService {
    private googleClient: OAuth2Client;

    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
    ) {
        this.googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    }

    private parseDateOnly(value: string): Date {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (!match) {
            throw new BadRequestException('dateOfBirth must be in YYYY-MM-DD format');
        }

        const [, yearText, monthText, dayText] = match;
        const year = Number(yearText);
        const month = Number(monthText);
        const day = Number(dayText);

        const parsed = new Date(Date.UTC(year, month - 1, day));
        const isValid =
            parsed.getUTCFullYear() === year &&
            parsed.getUTCMonth() === month - 1 &&
            parsed.getUTCDate() === day;

        if (!isValid) {
            throw new BadRequestException('dateOfBirth is not a valid calendar date');
        }

        return parsed;
    }

    private formatDateOnly(date: Date | null): string | null {
        if (!date) {
            return null;
        }

        return date.toISOString().slice(0, 10);
    }

    private resolveImageExtension(file: Express.Multer.File): 'jpg' | 'jpeg' | 'png' {
        if (file.mimetype === 'image/png') {
            return 'png';
        }

        if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') {
            return 'jpeg';
        }

        throw new BadRequestException('Only PNG and JPEG images are allowed');
    }

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

        return {
            accessToken: this.jwtService.sign({ sub: user.id, email: user.email }),
        };
    }

    async login(email: string, password: string) {
        const cleanEmail = email.trim().toLowerCase();

        const user = await this.prisma.user.findUnique({
            where: { email: cleanEmail }
        });

        if (!user) {
            throw new UnauthorizedException({
                error: "EMAIL_NOT_FOUND",
                message: "You must be registered"
            });
        }

        if (!user.passwordhash) {
            throw new UnauthorizedException({
                error: "NO_PASSWORD_USE_GOOGLE",
                message: "This account uses Google login"
            });
        }

        const isValid = await bcrypt.compare(password, user.passwordhash);
        if (!isValid) {
            throw new UnauthorizedException({
                error: "WRONG_PASSWORD",
                message: "Incorrect password"
            });
        }

        return {
            accessToken: this.jwtService.sign({
                sub: user.id,
                email: user.email,
            }),
        };
    }

    async googleLogin(idToken: string) {
        try {
            console.log("🔥 GOOGLE LOGIN: idToken received:", idToken.substring(0, 15) + "...");
            console.log("🌍 GOOGLE_CLIENT_ID =", process.env.GOOGLE_CLIENT_ID);
            console.log("🤖 GOOGLE_ANDROID_CLIENT_ID =", process.env.GOOGLE_ANDROID_CLIENT_ID);

            const audienceList = [
                process.env.GOOGLE_ANDROID_CLIENT_ID,
                process.env.GOOGLE_CLIENT_ID,
            ];

            console.log("🎯 AUDIENCE SENT TO GOOGLE:", audienceList);

            const ticket = await this.googleClient.verifyIdToken({
                idToken,
                audience: undefined,
            });

            console.log("🔥 GOOGLE LOGIN: Token OK, raw:", ticket);

            // @ts-ignore Google Auth library typing mismatch
            const payload = ticket.getPayload();

            console.log("🔍 PAYLOAD AZP:", payload?.azp);
            console.log("🔍 PAYLOAD AUD:", payload?.aud);
            console.log(
                "🔍 EXPECTED:",
                process.env.GOOGLE_ANDROID_CLIENT_ID,
                process.env.GOOGLE_CLIENT_ID
            );
            console.log("📦 GOOGLE LOGIN PAYLOAD:", payload);

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

    async getMe(userId: string) {
        console.log('🔍 GET ME userId:', userId);

        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                profileImageUrl: true,
                kroniqImageUrl: true,
                firstName: true,
                lastName: true,
                gender: true,
                dateOfBirth: true,
                passwordhash: true,
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
            profileImageUrl: user.profileImageUrl,
            kroniqImageUrl: user.kroniqImageUrl,
            firstName: user.firstName,
            lastName: user.lastName,
            gender: user.gender,
            dateOfBirth: this.formatDateOnly(user.dateOfBirth),
            isPremium: user.isPremium,
            isKroniq: user.isKroniq,
            hasPassword: Boolean(user.passwordhash),
        };
    }

    async updateMe(userId: string, body: UpdateMeDto) {
        const parsedDateOfBirth = body.dateOfBirth
            ? this.parseDateOnly(body.dateOfBirth)
            : undefined;

        await this.prisma.user.update({
            where: { id: userId },
            data: {
                name: body.name,
                firstName: body.firstName,
                lastName: body.lastName,
                gender: body.gender,
                dateOfBirth: parsedDateOfBirth,
            },
        });

        return this.getMe(userId);
    }

    async changePassword(userId: string, body: ChangePasswordDto) {
        if (!body.newPassword) {
            throw new BadRequestException('newPassword is required');
        }

        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                passwordhash: true,
            },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        const hasPassword = Boolean(user.passwordhash);

        if (hasPassword) {
            if (!body.currentPassword) {
                throw new BadRequestException('currentPassword is required');
            }

            const matchesCurrentPassword = await bcrypt.compare(
                body.currentPassword,
                user.passwordhash!,
            );

            if (!matchesCurrentPassword) {
                throw new UnauthorizedException({
                    error: 'WRONG_PASSWORD',
                    message: 'Current password is incorrect',
                });
            }

            const sameAsCurrent = await bcrypt.compare(body.newPassword, user.passwordhash!);
            if (sameAsCurrent) {
                throw new BadRequestException('New password must be different from current password');
            }
        }

        const newPasswordHash = await bcrypt.hash(body.newPassword, 10);

        await this.prisma.user.update({
            where: { id: userId },
            data: {
                passwordhash: newPasswordHash,
            },
        });

        return {
            success: true,
            hasPassword: true,
        };
    }

    async uploadProfilePhoto(userId: string, file: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException("Missing file field (multipart name must be 'file')");
        }

        if (!file.mimetype?.startsWith('image/')) {
            throw new BadRequestException('Only image files are allowed');
        }

        const currentUser = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { profileImageUrl: true },
        });

        if (!currentUser) {
            throw new UnauthorizedException('User not found');
        }

        const profileImageUrl = await uploadUserProfilePhoto(
            file.buffer,
            this.resolveImageExtension(file),
        );

        await this.prisma.user.update({
            where: { id: userId },
            data: { profileImageUrl },
        });

        if (currentUser.profileImageUrl) {
            try {
                await deletePublicFile(currentUser.profileImageUrl);
            } catch (error) {
                console.error('Failed to delete previous profile image:', error);
            }
        }

        return { profileImageUrl };
    }

    async deleteProfilePhoto(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { profileImageUrl: true },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        if (user.profileImageUrl) {
            try {
                await deletePublicFile(user.profileImageUrl);
            } catch (error) {
                console.error('Failed to delete profile image:', error);
                throw new InternalServerErrorException('Failed to delete profile image from storage');
            }
        }

        await this.prisma.user.update({
            where: { id: userId },
            data: { profileImageUrl: null },
        });

        return {
            success: true,
            profileImageUrl: null,
        };
    }

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
