import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TripMapService } from "./trip-map.service";
import { createHash } from "crypto";
import { LineString } from "geojson";
import { CreateTripDto } from "./dto/create-trip.dto";
import { deletePublicFile, uploadTripCover, uploadTripGalleryPhoto } from "../storage/r2-upload";
import { ForbiddenException } from "@nestjs/common";
import { canCreateTrip } from "./tripLimits"; // uprav cestu podle toho, kde máš soubor
import { UpdateTripDetailDto } from "./dto/update-trip-detail.dto";
import { CreateTripPhotoCategoryDto } from "./dto/create-trip-photo-category.dto";
import { UpdateTripPhotoCategoryDto } from "./dto/update-trip-photo-category.dto";
import { UpdateTripPhotoDto } from "./dto/update-trip-photo.dto";

import type { Express } from "express";

/**
 * 🔄 ZMĚŇ PŘI ÚPRAVĚ VZHLEDU MAPY
 * (styl, barvy, renderer, zoom, atd.)
 */
const MAP_RENDER_VERSION = "v1";
const DEFAULT_TRIP_PHOTO_CATEGORY_NAME = "Uncategorized";

@Injectable()
export class TripsService {
    private readonly logger = new Logger(TripsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tripMapService: TripMapService,
    ) {}

    // ─────────────────────────────
    // ✅ COVER UPLOAD (R2)
    // ─────────────────────────────
    async uploadCoverImage(ownerId: string, file: Express.Multer.File): Promise<string> {
        if (!file) throw new Error("No file provided");

        if (!file.mimetype?.startsWith("image/")) {
            throw new Error("Only image files are allowed");
        }

        const ext = this.resolveImageExtension(file);


        // FileInterceptor(memoryStorage) => file.buffer je Buffer ✅
        const url = await uploadTripCover(file.buffer, ext);

        this.logger.log(`🖼️ cover uploaded (R2): ${url}`);
        return url;
    }

    private resolveImageExtension(file: Express.Multer.File): "jpg" | "jpeg" | "png" {
        const rawExt =
            file.originalname?.split(".").pop()?.toLowerCase() ||
            (file.mimetype === "image/png" ? "png" : "jpg");

        if (rawExt === "png") return "png";
        if (rawExt === "jpeg") return "jpeg";
        return "jpg";
    }

    private async assertTripOwner(ownerId: string, tripId: string): Promise<void> {
        const trip = await this.prisma.trips.findFirst({
            where: { id: tripId, ownerId },
            select: { id: true },
        });

        if (!trip) {
            throw new NotFoundException("Trip not found");
        }
    }

    private async requireKroniqOwner(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                isKroniq: true,
            },
        });

        if (!user) {
            throw new NotFoundException("User not found");
        }

        if (!user.isKroniq) {
            throw new ForbiddenException({
                code: "KRONIQ_PLAN_REQUIRED",
                message: "KroniQ plan required",
            });
        }

        return user;
    }

    private async cleanupExpiredKroniqGuests(ownerId: string) {
        const group = await this.prisma.groups.findFirst({
            where: { adminId: ownerId },
            select: { id: true },
        });

        if (!group) {
            return null;
        }

        const expiredGuests = await this.prisma.groupMembers.findMany({
            where: {
                groupId: group.id,
                role: "GUEST",
                expiresAt: {
                    lte: new Date(),
                },
            },
            select: {
                userId: true,
            },
        });

        if (expiredGuests.length === 0) {
            return group.id;
        }

        const expiredGuestIds = expiredGuests.map((guest) => guest.userId);
        const sharedTrips = await this.prisma.trips.findMany({
            where: {
                ownerId,
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
                    groupId: group.id,
                    userId: { in: expiredGuestIds },
                },
            });
        });

        return group.id;
    }

    private async getKroniqParticipantMemberships(ownerId: string) {
        const groupId = await this.cleanupExpiredKroniqGuests(ownerId);
        if (!groupId) {
            return [];
        }

        return this.prisma.groupMembers.findMany({
            where: {
                groupId,
                userId: {
                    not: ownerId,
                },
            },
            select: {
                userId: true,
                role: true,
                expiresAt: true,
            },
        });
    }

    private async createTripSharesForMemberships(
        tripId: string,
        memberships: Array<{ userId: string; role: string; expiresAt: Date | null }>,
    ) {
        if (memberships.length === 0) {
            return;
        }

        await this.prisma.$transaction(
            memberships.map((membership) =>
                this.prisma.tripShares.upsert({
                    where: {
                        tripId_visitorId: {
                            tripId,
                            visitorId: membership.userId,
                        },
                    },
                    update: {
                        expiresAt: membership.role === "GUEST" ? membership.expiresAt : null,
                    },
                    create: {
                        tripId,
                        visitorId: membership.userId,
                        expiresAt: membership.role === "GUEST" ? membership.expiresAt : null,
                    },
                }),
            ),
        );
    }

    private mapTripDetail(trip: {
        id: string;
        coverImageUrl: string | null;
        mapImageUrl: string | null;
        mapImageFullUrl: string | null;
        ownerId: string;
        name: string;
        destination: string;
        transport: string;
        from: string;
        to: string;
        waypoints: string[];
        startDate: Date;
        endDate: Date;
        theme: string | null;
        plannedBudget: string | null;
        spentBudget: string | null;
        isSharedInKroniQ: boolean;
        createdAt: Date;
        TripChecklistItems: Array<{ id: string; text: string; checked: boolean; order: number }>;
        TripNotes: Array<{ id: string; text: string; order: number }>;
        TripTipsAndTrips: Array<{ id: string; title: string; imageUrl: string | null; order: number }>;
    }) {
        return {
            id: trip.id,
            coverImageUrl: trip.coverImageUrl ?? null,
            mapImageUrl: trip.mapImageUrl ?? null,
            mapImageFullUrl: trip.mapImageFullUrl ?? null,
            ownerId: trip.ownerId,
            name: trip.name,
            destination: trip.destination,
            transport: trip.transport,
            from: trip.from,
            to: trip.to,
            waypoints: trip.waypoints,
            startDate: trip.startDate.toISOString(),
            endDate: trip.endDate.toISOString(),
            theme: trip.theme ?? null,
            plannedBudget: trip.plannedBudget ?? null,
            spentBudget: trip.spentBudget ?? null,
            isSharedInKroniQ: trip.isSharedInKroniQ,
            createdAt: trip.createdAt.toISOString(),
            TripChecklistItems: trip.TripChecklistItems,
            TripNotes: trip.TripNotes,
            TripTipsAndTrips: trip.TripTipsAndTrips,
        };
    }

    private async findAccessibleTrip(userId: string, tripId: string) {
        return this.prisma.trips.findFirst({
            where: {
                id: tripId,
                OR: [
                    { ownerId: userId },
                    {
                        TripShares: {
                            some: {
                                visitorId: userId,
                                OR: [
                                    { expiresAt: null },
                                    { expiresAt: { gt: new Date() } },
                                ],
                            },
                        },
                    },
                ],
            },
            include: {
                TripChecklistItems: { orderBy: { order: "asc" } },
                TripNotes: { orderBy: { order: "asc" } },
                TripTipsAndTrips: { orderBy: { order: "asc" } },
            },
        });
    }

    private async ensureDefaultPhotoCategory(tripId: string) {
        const existing = await this.prisma.tripPhotoCategory.findFirst({
            where: { tripId, isDefault: true },
        });

        if (existing) {
            return existing;
        }

        return this.prisma.tripPhotoCategory.create({
            data: {
                tripId,
                name: DEFAULT_TRIP_PHOTO_CATEGORY_NAME,
                isDefault: true,
            },
        });
    }

    private mapPhotoCategory(category: { id: string; name: string }) {
        return {
            id: category.id,
            name: category.name,
        };
    }

    private mapTripPhoto(photo: {
        id: string;
        imageUrl: string;
        thumbnailUrl: string;
        categoryId: string;
        order: number;
        createdAt: Date;
    }) {
        return {
            id: photo.id,
            imageUrl: photo.imageUrl,
            thumbnailUrl: photo.thumbnailUrl,
            categoryId: photo.categoryId,
            order: photo.order,
            createdAt: photo.createdAt.toISOString(),
        };
    }

    private async getTripPhotoCategoryOrThrow(tripId: string, categoryId: string) {
        const category = await this.prisma.tripPhotoCategory.findFirst({
            where: {
                id: categoryId,
                tripId,
            },
        });

        if (!category) {
            throw new NotFoundException("Photo category not found");
        }

        return category;
    }

    // ─────────────────────────────
    // 🔢 ROUND COORDINATES
    // ─────────────────────────────
    private roundCoord(value: number, precision = 4): number {
        const factor = Math.pow(10, precision);
        return Math.round(value * factor) / factor;
    }

    // ─────────────────────────────
    // 🔑 CACHE KEY – GEO + VERSION
    // ─────────────────────────────
    private buildCacheKeyFromCoords(params: {
        fromLat: number;
        fromLon: number;
        toLat: number;
        toLon: number;
        transport: string;
    }): string {

        const normalized = [
            MAP_RENDER_VERSION, // 🔥 DŮLEŽITÉ
            this.roundCoord(params.fromLat),
            this.roundCoord(params.fromLon),
            this.roundCoord(params.toLat),
            this.roundCoord(params.toLon),
            params.transport.trim().toLowerCase(),
        ].join("|");

        return createHash("sha256")
            .update(normalized)
            .digest("hex");
    }

    // ─────────────────────────────
// 🗺️ GENERATE / RENDER MAP
// ─────────────────────────────
    async generateTripMap(params: {
        fromText: string;
        toText: string;
        fromPoint: { lat: number; lon: number };
        toPoint: { lat: number; lon: number };
        transport: string;
        route: LineString;
    }): Promise<{ imageUrl: string; imageFullUrl: string }> {

        const {
            fromText,
            toText,
            fromPoint,
            toPoint,
            transport,
            route,
        } = params;

        // 1️⃣ BUILD CACHE KEY (GEO BASED)
        const cacheKey = this.buildCacheKeyFromCoords({
            fromLat: fromPoint.lat,
            fromLon: fromPoint.lon,
            toLat: toPoint.lat,
            toLon: toPoint.lon,
            transport,
        });

        // 2️⃣ CACHE LOOKUP
        const cached = await this.prisma.tripMapCache.findUnique({
            where: { cacheKey },
        });

        if (cached) {
            this.logger.log(`🟢 MAP CACHE HIT`);
            return {
                imageUrl: cached.imageUrl,
                imageFullUrl: cached.imageFullUrl ?? cached.imageUrl, // fallback pro staré cache záznamy
            };
        }

        this.logger.log(`🔵 MAP CACHE MISS`);

        // 3️⃣ RENDER MAP (EXPENSIVE PART)
        const { imageUrl, imageFullUrl } = await this.tripMapService.renderTripMap(
            {
                segments: [
                    {
                        from: fromPoint,
                        to: toPoint,
                        transport,
                    },
                ],
            },
            route
        );

        // 4️⃣ SAVE CACHE
        await this.prisma.tripMapCache.create({
            data: {
                cacheKey,
                imageUrl,
                imageFullUrl, // ✅ NEW
                fromText,   // 🔍 jen pro debug / admin
                toText,     // 🔍 jen pro debug / admin
                transport,
            },
        });

        return { imageUrl, imageFullUrl };
    }

    // ─────────────────────────────
    // ➕ CREATE TRIP
    // ─────────────────────────────
    async createTrip(ownerId: string, dto: CreateTripDto) {
        // 1) Limit check
        const limit = await canCreateTrip(this.prisma, ownerId);

        if (!limit.allowed) {
            throw new ForbiddenException({
                code: "TRIP_LIMIT_REACHED",
                plan: limit.plan,
                used: limit.used,
                limit: limit.limit,
                windowDays: limit.windowDays,
                windowStart: limit.windowStart,
            });
        }

        // 2) Create trip
        const trip = await this.prisma.trips.create({
            data: {
                name: dto.name,
                destination: dto.destination,
                transport: dto.transport,
                from: dto.from,
                to: dto.to,
                waypoints: dto.waypoints ?? [],
                theme: dto.theme ?? null,
                startDate: new Date(dto.dateFrom),
                endDate: new Date(dto.dateTo),
                coverImageUrl: dto.coverImageUrl ?? null,
                mapImageUrl: dto.mapImageUrl ?? null,
                mapImageFullUrl: dto.mapImageFullUrl ?? null,
                isSharedInKroniQ: false,


                User: {
                    connect: {
                        id: ownerId,
                    },
                },
            },
        });

        return {
            id: trip.id,
            name: trip.name,
            createdAt: trip.createdAt,
            coverImageUrl: trip.coverImageUrl, // (můžeš vracet z tripu, je to jistější než dto)
            mapImageUrl: trip.mapImageUrl ?? null,
            mapImageFullUrl: trip.mapImageFullUrl ?? null,
        };
    }

    // ─────────────────────────────
    // 📜 TRIP HISTORY – MY TRIPS
    // ─────────────────────────────
    async getMyTrips(ownerId: string) {
        const trips = await this.prisma.trips.findMany({
            where: {
                OR: [
                    { ownerId },
                    {
                        TripShares: {
                            some: {
                                visitorId: ownerId,
                                OR: [
                                    { expiresAt: null },
                                    { expiresAt: { gt: new Date() } },
                                ],
                            },
                        },
                    },
                ],
            },
            orderBy: {
                createdAt: "desc",
            },
            select: {
                id: true,
                ownerId: true,
                name: true,
                coverImageUrl: true,
                mapImageUrl: true,
                theme: true,
                isSharedInKroniQ: true,
            },
        });

        // 🔁 mapování pro FE kontrakt
        return trips.map(trip => ({
            id: trip.id,
            title: trip.name,
            coverImageUrl: trip.coverImageUrl ?? null,
            mapImageUrl: trip.mapImageUrl ?? null,
            theme: trip.theme ?? null,
            isSharedInKroniQ: trip.isSharedInKroniQ,
            isSharedWithMe: trip.ownerId !== ownerId,
        }));
    }

    async getTripDetail(ownerId: string, tripId: string) {
        const trip = await this.findAccessibleTrip(ownerId, tripId);
        if (!trip) {
            return null;
        }

        return this.mapTripDetail(trip);
    }

    async updateTripDetail(ownerId: string, tripId: string, dto: UpdateTripDetailDto) {
        // 1) auth check: trip musí patřit userovi
        const existing = await this.prisma.trips.findFirst({
            where: { id: tripId, ownerId },
            select: { id: true },
        });
        if (!existing) return null;

        await this.prisma.$transaction(async (tx) => {
            // 2) update core fields + budget
            const tripData: any = {};

            // ✅ non-nullable fields -> null ignorovat
            if (dto.name !== undefined && dto.name !== null) tripData.name = dto.name;
            if (dto.destination !== undefined && dto.destination !== null) tripData.destination = dto.destination;
            if (dto.transport !== undefined && dto.transport !== null) tripData.transport = dto.transport;
            if (dto.from !== undefined && dto.from !== null) tripData.from = dto.from;
            if (dto.to !== undefined && dto.to !== null) tripData.to = dto.to;
            if (dto.waypoints !== undefined && dto.waypoints !== null) tripData.waypoints = dto.waypoints;
            if (dto.theme !== undefined && dto.theme !== null) tripData.theme = dto.theme;

            // ✅ nullable fields -> null propustit do DB
            if ("coverImageUrl" in dto) tripData.coverImageUrl = dto.coverImageUrl;
            if ("mapImageUrl" in dto) tripData.mapImageUrl = dto.mapImageUrl;
            if ("mapImageFullUrl" in dto) tripData.mapImageFullUrl = dto.mapImageFullUrl;
            if ("plannedBudget" in dto) tripData.plannedBudget = dto.plannedBudget;
            if ("spentBudget" in dto) tripData.spentBudget = dto.spentBudget;

            // ✅ nullable dates
            if (dto.startDate !== undefined && dto.startDate !== null) { tripData.startDate = new Date(dto.startDate);}
            if (dto.endDate !== undefined && dto.endDate !== null) { tripData.endDate = new Date(dto.endDate); }

            await tx.trips.update({
                where: { id: tripId },
                data: tripData,
            });

            // 3) replace checklist
            if (dto.checklistItems) {
                await tx.tripChecklistItem.deleteMany({ where: { tripId } });
                if (dto.checklistItems.length > 0) {
                    await tx.tripChecklistItem.createMany({
                        data: dto.checklistItems.map((i) => ({
                            tripId,
                            text: i.text,
                            checked: i.checked,
                            order: i.order,
                        })),
                    });
                }
            }

            // 4) replace notes
            if (dto.notes) {
                await tx.tripNote.deleteMany({ where: { tripId } });
                if (dto.notes.length > 0) {
                    await tx.tripNote.createMany({
                        data: dto.notes.map((n) => ({
                            tripId,
                            text: n.text,
                            order: n.order,
                        })),
                    });
                }
            }

            // 5) replace tips&trips
            if (dto.tipsAndTrips) {
                await tx.tripTipAndTrip.deleteMany({ where: { tripId } });
                if (dto.tipsAndTrips.length > 0) {
                    await tx.tripTipAndTrip.createMany({
                        data: dto.tipsAndTrips.map((t) => ({
                            tripId,
                            title: t.title,
                            imageUrl: t.imageUrl ?? null,
                            order: t.order,
                        })),
                    });
                }
            }
        });

        // 6) return fresh detail
        return this.getTripDetail(ownerId, tripId);
    }

    async deleteTrip(ownerId: string, tripId: string) {
        const existing = await this.prisma.trips.findFirst({
            where: { id: tripId, ownerId },
            select: { id: true },
        });

        if (!existing) return null;

        await this.prisma.trips.delete({
            where: { id: tripId },
        });

        return { success: true };
    }

    async getTripPhotos(ownerId: string, tripId: string) {
        const trip = await this.findAccessibleTrip(ownerId, tripId);
        if (!trip) {
            throw new NotFoundException("Trip not found");
        }
        await this.ensureDefaultPhotoCategory(tripId);

        const [categories, photos] = await this.prisma.$transaction([
            this.prisma.tripPhotoCategory.findMany({
                where: { tripId },
                orderBy: [
                    { isDefault: "desc" },
                    { createdAt: "asc" },
                ],
            }),
            this.prisma.tripPhoto.findMany({
                where: { tripId },
                orderBy: [
                    { order: "asc" },
                    { createdAt: "asc" },
                ],
            }),
        ]);

        return {
            categories: categories.map((category) => this.mapPhotoCategory(category)),
            photos: photos.map((photo) => this.mapTripPhoto(photo)),
        };
    }

    async uploadTripPhoto(ownerId: string, tripId: string, file: Express.Multer.File, categoryId?: string) {
        await this.assertTripOwner(ownerId, tripId);

        if (!file) {
            throw new BadRequestException("No file provided");
        }

        if (!file.mimetype?.startsWith("image/")) {
            throw new BadRequestException("Only image files are allowed");
        }

        const category = categoryId
            ? await this.getTripPhotoCategoryOrThrow(tripId, categoryId)
            : await this.ensureDefaultPhotoCategory(tripId);

        const ext = this.resolveImageExtension(file);
        const { imageUrl, thumbnailUrl } = await uploadTripGalleryPhoto(tripId, file.buffer, ext);

        const orderAggregate = await this.prisma.tripPhoto.aggregate({
            where: { tripId },
            _max: { order: true },
        });

        const photo = await this.prisma.tripPhoto.create({
            data: {
                tripId,
                categoryId: category.id,
                imageUrl,
                thumbnailUrl,
                order: (orderAggregate._max.order ?? -1) + 1,
            },
        });

        return {
            photo: this.mapTripPhoto(photo),
        };
    }

    async createTripPhotoCategory(ownerId: string, tripId: string, dto: CreateTripPhotoCategoryDto) {
        await this.assertTripOwner(ownerId, tripId);
        await this.ensureDefaultPhotoCategory(tripId);

        const category = await this.prisma.tripPhotoCategory.create({
            data: {
                tripId,
                name: dto.name.trim(),
                isDefault: false,
            },
        });

        return {
            category: this.mapPhotoCategory(category),
        };
    }

    async renameTripPhotoCategory(ownerId: string, tripId: string, categoryId: string, dto: UpdateTripPhotoCategoryDto) {
        await this.assertTripOwner(ownerId, tripId);

        const category = await this.getTripPhotoCategoryOrThrow(tripId, categoryId);
        if (category.isDefault) {
            throw new BadRequestException("Default category cannot be renamed");
        }

        const updated = await this.prisma.tripPhotoCategory.update({
            where: { id: categoryId },
            data: {
                name: dto.name.trim(),
            },
        });

        return {
            category: this.mapPhotoCategory(updated),
        };
    }

    async deleteTripPhotoCategory(ownerId: string, tripId: string, categoryId: string) {
        await this.assertTripOwner(ownerId, tripId);

        const category = await this.getTripPhotoCategoryOrThrow(tripId, categoryId);
        if (category.isDefault) {
            throw new BadRequestException("Default category cannot be deleted");
        }

        const defaultCategory = await this.ensureDefaultPhotoCategory(tripId);

        await this.prisma.$transaction(async (tx) => {
            await tx.tripPhoto.updateMany({
                where: {
                    tripId,
                    categoryId,
                },
                data: {
                    categoryId: defaultCategory.id,
                },
            });

            await tx.tripPhotoCategory.delete({
                where: { id: categoryId },
            });
        });

        return { success: true };
    }

    async updateTripPhoto(ownerId: string, tripId: string, photoId: string, dto: UpdateTripPhotoDto) {
        await this.assertTripOwner(ownerId, tripId);

        const photo = await this.prisma.tripPhoto.findFirst({
            where: {
                id: photoId,
                tripId,
            },
        });

        if (!photo) {
            throw new NotFoundException("Photo not found");
        }

        const category = await this.getTripPhotoCategoryOrThrow(tripId, dto.categoryId);

        const updated = await this.prisma.tripPhoto.update({
            where: { id: photoId },
            data: {
                categoryId: category.id,
            },
        });

        return {
            photo: this.mapTripPhoto(updated),
        };
    }

    async deleteTripPhoto(ownerId: string, tripId: string, photoId: string) {
        await this.assertTripOwner(ownerId, tripId);

        const photo = await this.prisma.tripPhoto.findFirst({
            where: {
                id: photoId,
                tripId,
            },
        });

        if (!photo) {
            throw new NotFoundException("Photo not found");
        }

        await this.prisma.tripPhoto.delete({
            where: { id: photoId },
        });

        const urlsToDelete = [photo.imageUrl, photo.thumbnailUrl].filter(Boolean);
        for (const url of urlsToDelete) {
            try {
                await deletePublicFile(url);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.logger.warn(`Failed to delete trip gallery asset from R2: ${message}`);
            }
        }

        return { success: true };
    }

    async shareTripInKroniq(ownerId: string, tripId: string) {
        await this.assertTripOwner(ownerId, tripId);
        await this.requireKroniqOwner(ownerId);

        const memberships = await this.getKroniqParticipantMemberships(ownerId);

        await this.prisma.trips.update({
            where: { id: tripId },
            data: {
                isSharedInKroniQ: true,
            },
        });

        await this.createTripSharesForMemberships(tripId, memberships);

        return {
            success: true,
            isSharedInKroniQ: true,
        };
    }

    async unshareTripInKroniq(ownerId: string, tripId: string) {
        await this.assertTripOwner(ownerId, tripId);
        await this.requireKroniqOwner(ownerId);

        await this.prisma.$transaction(async (tx) => {
            await tx.trips.update({
                where: { id: tripId },
                data: {
                    isSharedInKroniQ: false,
                },
            });

            await tx.tripShares.deleteMany({
                where: { tripId },
            });
        });

        return {
            success: true,
            isSharedInKroniQ: false,
        };
    }



}
