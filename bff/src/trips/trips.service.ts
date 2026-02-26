import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TripMapService } from "./trip-map.service";
import {createHash, randomUUID} from "crypto";
import { LineString } from "geojson";
import {CreateTripDto} from "./dto/create-trip.dto";
import path from "node:path";
import * as fs from "fs/promises";
import { uploadTripCover } from "../storage/r2-upload";
import { ForbiddenException } from "@nestjs/common";
import { canCreateTrip } from "./tripLimits"; // uprav cestu podle toho, kde máš soubor
import { UpdateTripDetailDto } from "./dto/update-trip-detail.dto";

import type { Express } from "express";

/**
 * 🔄 ZMĚŇ PŘI ÚPRAVĚ VZHLEDU MAPY
 * (styl, barvy, renderer, zoom, atd.)
 */
const MAP_RENDER_VERSION = "v1";

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

        const rawExt =
            file.originalname?.split(".").pop()?.toLowerCase() ||
            (file.mimetype === "image/png" ? "png" : "jpg");

        const ext: "jpg" | "jpeg" | "png" =
            rawExt === "png" ? "png" :
                rawExt === "jpeg" ? "jpeg" :
                    "jpg";


        // FileInterceptor(memoryStorage) => file.buffer je Buffer ✅
        const url = await uploadTripCover(file.buffer, ext);

        this.logger.log(`🖼️ cover uploaded (R2): ${url}`);
        return url;
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
                ownerId,
            },
            orderBy: {
                createdAt: "desc",
            },
            select: {
                id: true,
                name: true,
                coverImageUrl: true,
                mapImageUrl: true,
            },
        });

        // 🔁 mapování pro FE kontrakt
        return trips.map(trip => ({
            id: trip.id,
            title: trip.name,
            coverImageUrl: trip.coverImageUrl ?? null,
            mapImageUrl: trip.mapImageUrl ?? null,
        }));
    }

    async getTripDetail(ownerId: string, tripId: string) {
        return this.prisma.trips.findFirst({
            where: { id: tripId, ownerId },
            include: {
                TripChecklistItems: { orderBy: { order: "asc" } },
                TripNotes: { orderBy: { order: "asc" } },
                TripTipsAndTrips: { orderBy: { order: "asc" } },
            },
        });
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
            await tx.trips.update({
                where: { id: tripId },
                data: {
                    name: dto.name ?? undefined,
                    destination: dto.destination ?? undefined,
                    transport: dto.transport ?? undefined,
                    from: dto.from ?? undefined,
                    to: dto.to ?? undefined,
                    waypoints: dto.waypoints ?? undefined,
                    theme: dto.theme ?? undefined,
                    coverImageUrl: dto.coverImageUrl ?? undefined,
                    mapImageUrl: dto.mapImageUrl ?? undefined,
                    mapImageFullUrl: dto.mapImageFullUrl ?? undefined,

                    plannedBudget: dto.plannedBudget ?? undefined,
                    spentBudget: dto.spentBudget ?? undefined,

                    // pokud budeš chtít start/end date: parsuj string na Date
                    // startDate: dto.startDate ? new Date(dto.startDate) : undefined,
                    // endDate: dto.endDate ? new Date(dto.endDate) : undefined,
                },
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



}
