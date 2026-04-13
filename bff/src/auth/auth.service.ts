import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    InternalServerErrorException,
    Logger,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { deletePublicFile, uploadUserProfilePhoto } from '../storage/r2-upload';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateMeDto } from './dto/update-me.dto';

@Injectable()
export class AuthService {
    private googleClient: OAuth2Client;
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
    ) {
        this.googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    }

    private async verifyGoogleReauth(user: {
        id: string;
        email: string;
        provider: string | null;
        providerId: string | null;
    }, googleIdToken?: string) {
        if (!googleIdToken) {
            throw new UnauthorizedException({
                code: 'GOOGLE_REAUTH_REQUIRED',
                message: 'Fresh Google re-auth is required',
            });
        }

        let payload;
        try {
            const ticket = await this.googleClient.verifyIdToken({
                idToken: googleIdToken,
                audience: undefined,
            });

            payload = ticket.getPayload();
        } catch (error) {
            throw new UnauthorizedException({
                code: 'GOOGLE_REAUTH_REQUIRED',
                message: 'Invalid Google re-auth token',
            });
        }

        if (!payload?.email || !payload.sub) {
            throw new UnauthorizedException({
                code: 'GOOGLE_REAUTH_REQUIRED',
                message: 'Invalid Google re-auth token',
            });
        }

        if (
            payload.email !== user.email ||
            (user.provider === 'GOOGLE' && user.providerId && payload.sub !== user.providerId)
        ) {
            throw new UnauthorizedException({
                code: 'GOOGLE_REAUTH_REQUIRED',
                message: 'Google re-auth does not match the current user',
            });
        }
    }

    private async deleteStorageUrl(url: string | null | undefined) {
        if (!url) {
            return;
        }

        try {
            await deletePublicFile(url);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Failed to delete account asset from R2: ${message}`);
        }
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

        const cleanEmail = email.trim().toLowerCase();

        const existing = await this.prisma.user.findFirst({
            where: {
                email: cleanEmail,
                deletedAt: null,
            },
        });

        if (existing) {
            throw new BadRequestException('Email already exists');
        }

        const hashed = await bcrypt.hash(password, 10);

        const user = await this.prisma.user.create({
            data: {
                email: cleanEmail,
                passwordhash: hashed,
            },
        });

        return {
            accessToken: this.jwtService.sign({ sub: user.id, email: user.email }),
        };
    }

    async login(email: string, password: string) {
        const cleanEmail = email.trim().toLowerCase();

        const user = await this.prisma.user.findFirst({
            where: {
                email: cleanEmail,
                deletedAt: null,
            },
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

            let user = await this.prisma.user.findFirst({
                where: {
                    email,
                    deletedAt: null,
                },
            });

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
                deletedAt: true,
            },
        });

        console.log('👤 USER FROM DB:', user);

        if (!user || user.deletedAt) {
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
                deletedAt: true,
            },
        });

        if (!user || user.deletedAt) {
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
            select: { profileImageUrl: true, deletedAt: true },
        });

        if (!currentUser || currentUser.deletedAt) {
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
            select: { profileImageUrl: true, deletedAt: true },
        });

        if (!user || user.deletedAt) {
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
            select: { isPremium: true, isKroniq: true, deletedAt: true },
        });

        if (!user || user.deletedAt) {
            throw new UnauthorizedException('User not found');
        }

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

    async deleteAccount(userId: string, body: DeleteAccountDto) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                passwordhash: true,
                provider: true,
                providerId: true,
                profileImageUrl: true,
                kroniqImageUrl: true,
                deletedAt: true,
            },
        });

        if (!user || user.deletedAt) {
            throw new UnauthorizedException('User not found');
        }

        if (user.passwordhash) {
            if (!body.currentPassword) {
                throw new UnauthorizedException({
                    code: 'RECENT_REAUTH_REQUIRED',
                    message: 'Current password is required',
                });
            }

            const passwordValid = await bcrypt.compare(body.currentPassword, user.passwordhash);
            if (!passwordValid) {
                throw new UnauthorizedException({
                    code: 'INVALID_PASSWORD',
                    message: 'Current password is incorrect',
                });
            }
        } else if (user.provider === 'GOOGLE') {
            await this.verifyGoogleReauth(user, body.googleIdToken);
        } else {
            throw new ForbiddenException({
                code: 'DELETE_NOT_ALLOWED',
                message: 'Account deletion is not available for this account type',
            });
        }

        const ownedTrips = await this.prisma.trips.findMany({
            where: { ownerId: userId },
            select: {
                id: true,
                coverImageUrl: true,
                mapImageUrl: true,
                mapImageFullUrl: true,
                TripTipsAndTrips: {
                    select: {
                        imageUrl: true,
                    },
                },
                TripPhotos: {
                    select: {
                        imageUrl: true,
                        thumbnailUrl: true,
                    },
                },
            },
        });

        const assetUrls = new Set<string>();
        if (user.profileImageUrl) assetUrls.add(user.profileImageUrl);
        if (user.kroniqImageUrl) assetUrls.add(user.kroniqImageUrl);

        for (const trip of ownedTrips) {
            if (trip.coverImageUrl) assetUrls.add(trip.coverImageUrl);
            if (trip.mapImageUrl) assetUrls.add(trip.mapImageUrl);
            if (trip.mapImageFullUrl) assetUrls.add(trip.mapImageFullUrl);

            for (const tip of trip.TripTipsAndTrips) {
                if (tip.imageUrl) assetUrls.add(tip.imageUrl);
            }

            for (const photo of trip.TripPhotos) {
                assetUrls.add(photo.imageUrl);
                assetUrls.add(photo.thumbnailUrl);
            }
        }

        const deletedEmail = `deleted+${user.id}@deleted.memotrip.local`;

        await this.prisma.$transaction(async (tx) => {
            await tx.groups.deleteMany({
                where: { adminId: userId },
            });

            await tx.groupMembers.deleteMany({
                where: { userId },
            });

            await tx.tripShares.deleteMany({
                where: { visitorId: userId },
            });

            await tx.trips.deleteMany({
                where: { ownerId: userId },
            });

            await tx.notification.deleteMany({
                where: { userid: userId },
            });

            await tx.order.updateMany({
                where: { userid: userId },
                data: { userid: null },
            });

            await tx.user.update({
                where: { id: userId },
                data: {
                    email: deletedEmail,
                    passwordhash: null,
                    name: null,
                    profileImageUrl: null,
                    kroniqImageUrl: null,
                    firstName: null,
                    lastName: null,
                    gender: null,
                    dateOfBirth: null,
                    isPremium: false,
                    isKroniq: false,
                    provider: null,
                    providerId: null,
                    deletedAt: new Date(),
                },
            });
        });

        for (const url of assetUrls) {
            await this.deleteStorageUrl(url);
        }

        return {
            success: true,
        };
    }
}
