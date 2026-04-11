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
import { AddKroniqMemberDto } from './dto/add-kroniq-member.dto';

@Injectable()
export class KroniqService {
    constructor(private readonly prisma: PrismaService) {}

    private mapMember(member: {
        role: string;
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
        };
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

        return {
            success: true,
            member: this.mapMember(createdMember),
        };
    }

    async removeMember(ownerId: string, memberId: string) {
        await this.requireKroniqOwner(ownerId);
        const groupId = await this.ensureOwnerGroup(ownerId);

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

        return {
            success: true,
        };
    }

    async getMe(ownerId: string) {
        const owner = await this.requireKroniqOwner(ownerId);
        const groupId = await this.ensureOwnerGroup(ownerId);

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
