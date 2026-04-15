import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import type { Express } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { deletePublicFile, uploadKroniqPhoto } from '../storage/r2-upload';
import { AddKroniqGuestDto } from './dto/add-kroniq-guest.dto';
import { AddKroniqMemberDto } from './dto/add-kroniq-member.dto';

@Injectable()
export class KroniqService {
    constructor(private readonly prisma: PrismaService) {}

    private async syncSharedTripsForMembership(ownerId: string, membership: {
        userId: string;
        role: string;
        expiresAt: Date | null;
    }) {
        const sharedTrips = await this.prisma.trips.findMany({
            where: {
                ownerId,
                isSharedInKroniQ: true,
            },
            select: { id: true },
        });

        if (sharedTrips.length === 0) {
            return;
        }

        await this.prisma.$transaction(
            sharedTrips.map((trip) =>
                this.prisma.tripShares.upsert({
                    where: {
                        tripId_visitorId: {
                            tripId: trip.id,
                            visitorId: membership.userId,
                        },
                    },
                    update: {
                        expiresAt: membership.role === 'GUEST' ? membership.expiresAt : null,
                    },
                    create: {
                        tripId: trip.id,
                        visitorId: membership.userId,
                        expiresAt: membership.role === 'GUEST' ? membership.expiresAt : null,
                    },
                }),
            ),
        );
    }

    private async removeSharedTripsForMembership(ownerId: string, visitorId: string) {
        const sharedTrips = await this.prisma.trips.findMany({
            where: {
                ownerId,
                isSharedInKroniQ: true,
            },
            select: { id: true },
        });

        if (sharedTrips.length === 0) {
            return;
        }

        await this.prisma.tripShares.deleteMany({
            where: {
                visitorId,
                tripId: {
                    in: sharedTrips.map((trip) => trip.id),
                },
            },
        });
    }

    private mapMember(member: {
        role: string;
        expiresAt: Date | null;
        User: {
            id: string;
            email: string;
            name: string | null;
            profileImageUrl: string | null;
        };
    }) {
        return {
            id: member.User.id,
            email: member.User.email,
            name: member.User.name,
            role: member.role,
            profileImageUrl: member.User.profileImageUrl,
            expiresAt: member.expiresAt?.toISOString() ?? null,
        };
    }

    private async cleanupExpiredGuests(groupId: string) {
        const group = await this.prisma.groups.findUnique({
            where: { id: groupId },
            select: {
                id: true,
                adminId: true,
            },
        });

        if (!group) {
            return;
        }

        const expiredGuests = await this.prisma.groupMembers.findMany({
            where: {
                groupId,
                role: 'GUEST',
                expiresAt: {
                    lte: new Date(),
                },
            },
            select: {
                userId: true,
            },
        });

        if (expiredGuests.length === 0) {
            return;
        }

        const expiredGuestIds = expiredGuests.map((guest) => guest.userId);
        const sharedTrips = await this.prisma.trips.findMany({
            where: {
                ownerId: group.adminId,
                isSharedInKroniQ: true,
            },
            select: { id: true },
        });

        await this.prisma.$transaction(async (tx) => {
            if (sharedTrips.length > 0) {
                await tx.tripShares.deleteMany({
                    where: {
                        visitorId: { in: expiredGuestIds },
                        tripId: { in: sharedTrips.map((trip) => trip.id) },
                    },
                });
            }

            await tx.groupMembers.deleteMany({
                where: {
                    groupId,
                    userId: { in: expiredGuestIds },
                },
            });
        });
    }

    private async requireKroniqOwner(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                isKroniq: true,
                kroniqImageUrl: true,
            },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        if (!user.isKroniq) {
            throw new ForbiddenException({
                code: 'KRONIQ_PLAN_REQUIRED',
                message: 'KroniQ plan required',
            });
        }

        return user;
    }

    private async ensureOwnerGroup(userId: string) {
        const existingGroup = await this.prisma.groups.findFirst({
            where: { adminId: userId },
            select: { id: true },
        });

        if (existingGroup) {
            const adminMembership = await this.prisma.groupMembers.findUnique({
                where: {
                    userId_groupId: {
                        userId,
                        groupId: existingGroup.id,
                    },
                },
                select: { userId: true },
            });

            if (!adminMembership) {
                await this.prisma.groupMembers.create({
                    data: {
                        userId,
                        groupId: existingGroup.id,
                        role: 'ADMIN',
                    },
                });
            }

            return existingGroup.id;
        }

        const createdGroup = await this.prisma.groups.create({
            data: {
                adminId: userId,
                GroupMembers: {
                    create: {
                        userId,
                        role: 'ADMIN',
                    },
                },
            },
            select: { id: true },
        });

        return createdGroup.id;
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

    async uploadPhoto(userId: string, file: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException("Missing file field (multipart name must be 'file')");
        }

        if (!file.mimetype?.startsWith('image/')) {
            throw new BadRequestException('Only image files are allowed');
        }

        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { kroniqImageUrl: true },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        const kroniqImageUrl = await uploadKroniqPhoto(
            file.buffer,
            this.resolveImageExtension(file),
        );

        await this.prisma.user.update({
            where: { id: userId },
            data: { kroniqImageUrl },
        });

        if (user.kroniqImageUrl) {
            try {
                await deletePublicFile(user.kroniqImageUrl);
            } catch (error) {
                console.error('Failed to delete previous KroniQ image:', error);
            }
        }

        return { kroniqImageUrl };
    }

    async deletePhoto(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { kroniqImageUrl: true },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        if (user.kroniqImageUrl) {
            try {
                await deletePublicFile(user.kroniqImageUrl);
            } catch (error) {
                console.error('Failed to delete KroniQ image:', error);
                throw new InternalServerErrorException('Failed to delete KroniQ image from storage');
            }
        }

        await this.prisma.user.update({
            where: { id: userId },
            data: { kroniqImageUrl: null },
        });

        return {
            success: true,
            kroniqImageUrl: null,
        };
    }

    async addMember(ownerId: string, dto: AddKroniqMemberDto) {
        await this.requireKroniqOwner(ownerId);

        const normalizedEmail = dto.email.trim().toLowerCase();
        const memberUser = await this.prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: {
                id: true,
                email: true,
                name: true,
                profileImageUrl: true,
            },
        });

        if (!memberUser) {
            throw new NotFoundException({
                code: 'USER_NOT_FOUND',
                message: 'User not found',
            });
        }

        const groupId = await this.ensureOwnerGroup(ownerId);
        await this.cleanupExpiredGuests(groupId);

        const existingMembership = await this.prisma.groupMembers.findUnique({
            where: {
                userId_groupId: {
                    userId: memberUser.id,
                    groupId,
                },
            },
            select: { userId: true },
        });

        if (existingMembership) {
            throw new ConflictException({
                code: 'ALREADY_MEMBER',
                message: 'User is already a member',
            });
        }

        const createdMember = await this.prisma.groupMembers.create({
            data: {
                userId: memberUser.id,
                groupId,
                role: memberUser.id === ownerId ? 'ADMIN' : 'MEMBER',
            },
            include: {
                User: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        profileImageUrl: true,
                    },
                },
            },
        });

        if (memberUser.id !== ownerId) {
            await this.syncSharedTripsForMembership(ownerId, {
                userId: memberUser.id,
                role: 'MEMBER',
                expiresAt: null,
            });
        }

        return {
            success: true,
            member: this.mapMember(createdMember),
        };
    }

    async addGuest(ownerId: string, dto: AddKroniqGuestDto) {
        await this.requireKroniqOwner(ownerId);

        const normalizedEmail = dto.email.trim().toLowerCase();
        const guestUser = await this.prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: {
                id: true,
                email: true,
                name: true,
                profileImageUrl: true,
            },
        });

        if (!guestUser) {
            throw new NotFoundException({
                code: 'USER_NOT_FOUND',
                message: 'User not found',
            });
        }

        const groupId = await this.ensureOwnerGroup(ownerId);
        await this.cleanupExpiredGuests(groupId);

        const existingMembership = await this.prisma.groupMembers.findUnique({
            where: {
                userId_groupId: {
                    userId: guestUser.id,
                    groupId,
                },
            },
            select: {
                role: true,
            },
        });

        if (existingMembership?.role === 'GUEST') {
            throw new ConflictException({
                code: 'ALREADY_GUEST',
                message: 'User is already a guest',
            });
        }

        if (existingMembership) {
            throw new ConflictException({
                code: 'ALREADY_MEMBER',
                message: 'User is already a member',
            });
        }

        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

        const createdGuest = await this.prisma.groupMembers.create({
            data: {
                userId: guestUser.id,
                groupId,
                role: 'GUEST',
                expiresAt,
            },
            include: {
                User: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        profileImageUrl: true,
                    },
                },
            },
        });

        await this.syncSharedTripsForMembership(ownerId, {
            userId: guestUser.id,
            role: 'GUEST',
            expiresAt,
        });

        return {
            success: true,
            guest: this.mapMember(createdGuest),
        };
    }

    async removeMember(ownerId: string, memberId: string) {
        await this.requireKroniqOwner(ownerId);
        const groupId = await this.ensureOwnerGroup(ownerId);
        await this.cleanupExpiredGuests(groupId);

        if (memberId === ownerId) {
            throw new ConflictException({
                code: 'CANNOT_REMOVE_SELF',
                message: 'Cannot remove self',
            });
        }

        const existingMembership = await this.prisma.groupMembers.findUnique({
            where: {
                userId_groupId: {
                    userId: memberId,
                    groupId,
                },
            },
            select: {
                userId: true,
            },
        });

        if (!existingMembership) {
            throw new NotFoundException({
                code: 'MEMBER_NOT_FOUND',
                message: 'Member not found',
            });
        }

        await this.prisma.groupMembers.delete({
            where: {
                userId_groupId: {
                    userId: memberId,
                    groupId,
                },
            },
        });

        await this.removeSharedTripsForMembership(ownerId, memberId);

        return {
            success: true,
        };
    }

    async getMe(ownerId: string) {
        const owner = await this.requireKroniqOwner(ownerId);
        const groupId = await this.ensureOwnerGroup(ownerId);
        await this.cleanupExpiredGuests(groupId);

        const members = await this.prisma.groupMembers.findMany({
            where: { groupId },
            orderBy: [
                { role: 'asc' },
                { User: { email: 'asc' } },
            ],
            include: {
                User: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        profileImageUrl: true,
                    },
                },
            },
        });

        return {
            kroniqImageUrl: owner.kroniqImageUrl,
            members: members.map((member) => this.mapMember(member)),
        };
    }
}
