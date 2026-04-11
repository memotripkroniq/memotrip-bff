import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    UnauthorizedException,
} from '@nestjs/common';
import type { Express } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { deletePublicFile, uploadKroniqPhoto } from '../storage/r2-upload';

@Injectable()
export class KroniqService {
    constructor(private readonly prisma: PrismaService) {}

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
}
