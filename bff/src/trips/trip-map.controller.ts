import { Body, Controller, Post, Logger } from "@nestjs/common";
import { TripMapService } from "./trip-map.service";
import { GenerateTripMapDto, TransportType } from "./dto/generate-trip-map.dto";
import { PointDto, RenderTripMapDto } from "./dto/render-trip-map.dto";
import { OsmGeocodingService } from "../locations/osm-geocoding.service";
import { OsrmRoutingService } from "./osrm-routing.service";
import { AiRoutePlannerService } from "./ai-route-planner.service";
import type { LineString } from "geojson";

@Controller("trips")
export class TripMapController {
    private readonly logger = new Logger(TripMapController.name);

    constructor(
        private readonly tripMapService: TripMapService,
        private readonly geocoding: OsmGeocodingService,
        private readonly osrm: OsrmRoutingService,
        private readonly aiPlanner: AiRoutePlannerService
    ) {}

    @Post("generate-map")
    async generateMap(@Body() dto: GenerateTripMapDto) {
        return this.tripMapService.generateTripMap(dto);
    }

    @Post("render-map")
    async renderMap(@Body() dto: GenerateTripMapDto) {
        // 1) AI plán segmentů
        const plan = await this.aiPlanner.plan(dto);
        this.logger.log(`AI PLAN: ${JSON.stringify(plan)}`);

        // 2) In-request geocode cache (aby se negeokódovalo 10x to samé "Košice")
        const geoCache = new Map<string, PointDto>();
        const geocodeCached = async (text: string): Promise<PointDto> => {
            const key = text.trim();
            const cached = geoCache.get(key);
            if (cached) return cached;

            const p = await this.geocoding.geocode(key);
            geoCache.set(key, p);
            return p;
        };

        // 2.5) BACKEND HEURISTIKA – krátké úseky NESMÍ být PLANE
        const MIN_PLANE_DISTANCE_KM = 150;

        for (const seg of plan.segments) {
            if (seg.transport === TransportType.PLANE) {
                const fromPoint = await geocodeCached(seg.from);
                const toPoint = await geocodeCached(seg.to);

                const distanceKm = haversineKm(fromPoint, toPoint);

                if (distanceKm < MIN_PLANE_DISTANCE_KM) {
                    this.logger.log(
                        `Switching PLANE -> CAR for short segment (${distanceKm.toFixed(1)} km): ${seg.from} → ${seg.to}`
                    );
                    seg.transport = TransportType.CAR;
                }
            }
        }


        // 3) Urči, co jde přes OSRM a co jako přímka
        const OSRM_TRANSPORTS = new Set<TransportType>([
            TransportType.CAR,
            TransportType.CARAVAN,
            TransportType.CAMPER,
            TransportType.MOTORCYCLE,
            TransportType.BIKE,
            TransportType.WALK,
        ]);

        const DIRECT_LINE_TRANSPORTS = new Set<TransportType>([
            TransportType.PLANE,
            TransportType.TRAIN,
            TransportType.SHIP,
        ]);

        // 4) Připrav render DTO (segmenty v geo bodech)
        const renderDto: RenderTripMapDto = {
            segments: [],
        };

        // 5) Pro každý segment spočítej geometrii a sbírej koordináty pro finální sloučenou trasu
        const lineParts: number[][][] = []; // array of LineString.coordinates

        for (const seg of plan.segments) {
            const fromPoint = await geocodeCached(seg.from);
            const toPoint = await geocodeCached(seg.to);

            // pro render metadata
            renderDto.segments.push({
                from: fromPoint,
                to: toPoint,
                transport: seg.transport,
            });

            // geometrie
            if (OSRM_TRANSPORTS.has(seg.transport)) {
                const route = await this.osrm.route(fromPoint, toPoint, []); // bez stops, protože segment je už "from -> to"
                lineParts.push(route.geometry.coordinates);
                continue;
            }

            if (DIRECT_LINE_TRANSPORTS.has(seg.transport)) {
                lineParts.push([
                    [fromPoint.lon, fromPoint.lat],
                    [toPoint.lon, toPoint.lat],
                ]);
                continue;
            }

            // bezpečný fallback (kdyby přibyly nové transporty)
            this.logger.warn(`Unknown transport "${seg.transport}", using direct line fallback`);
            lineParts.push([
                [fromPoint.lon, fromPoint.lat],
                [toPoint.lon, toPoint.lat],
            ]);
        }

        // 6) Sloučení do jednoho LineString (protože tvůj renderer teď bere LineString)
        const merged: LineString = {
            type: "LineString",
            coordinates: mergeLineParts(lineParts),
        };

        // 7) Render do PNG + upload (přes existující TripMapService)
        const { imageUrl } = await this.tripMapService.renderTripMap(renderDto, merged);

        return {
            imageUrl,
            plan, // nechávám v response zatím pro debug; ve FÁZI 4 můžeme vypnout
        };
    }
}

/**
 * Sloučí více LineString částí do jednoho LineString.
 * Odstraní duplicitní navazující bod (když poslední bod části == první bod další části).
 */
function mergeLineParts(parts: number[][][]): number[][] {
    const out: number[][] = [];

    const same = (a: number[], b: number[]) =>
        a[0] === b[0] && a[1] === b[1];

    for (const coords of parts) {
        if (!coords?.length) continue;

        if (out.length === 0) {
            out.push(...coords);
            continue;
        }

        // když navazuje, tak první bod nové části vynech
        if (same(out[out.length - 1], coords[0])) {
            out.push(...coords.slice(1));
        } else {
            out.push(...coords);
        }
    }

    return out;
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;

    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

    return 2 * R * Math.asin(Math.sqrt(h));
}
