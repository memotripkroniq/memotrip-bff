import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TripMapService } from "./trip-map.service";
import { createHash } from "crypto";
import { LineString } from "geojson";

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
    }): Promise<string> {

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
            return cached.imageUrl;
        }

        this.logger.log(`🔵 MAP CACHE MISS`);

        // 3️⃣ RENDER MAP (EXPENSIVE PART)
        const { imageUrl } = await this.tripMapService.renderTripMap(
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
                fromText,   // 🔍 jen pro debug / admin
                toText,     // 🔍 jen pro debug / admin
                transport,
            },
        });

        return imageUrl;
    }
}
