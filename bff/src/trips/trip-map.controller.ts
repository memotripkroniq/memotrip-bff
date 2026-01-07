import { Body, Controller, Post, Logger } from "@nestjs/common";
import { TripMapService } from "./trip-map.service";
import { GenerateTripMapDto } from "./dto/generate-trip-map.dto";
import { PointDto } from "./dto/render-trip-map.dto";
import { OsmGeocodingService } from "../locations/osm-geocoding.service";
import { OsrmRoutingService } from "./osrm-routing.service";
import { AiRoutePlannerService } from "./ai-route-planner.service";

@Controller("trips")
export class TripMapController {
    private readonly logger = new Logger(TripMapController.name);

    constructor(
        private readonly tripMapService: TripMapService,
        private readonly geocoding: OsmGeocodingService,
        private readonly osrm: OsrmRoutingService,
        private readonly aiPlanner: AiRoutePlannerService
    ) {}

    /**
     * 🔴 STÁVAJÍCÍ ENDPOINT
     * AI ilustrace mapy (OpenAI)
     * NEMĚNÍME – funguje a zůstává
     */
    @Post("generate-map")
    async generateMap(
        @Body() dto: GenerateTripMapDto
    ) {
        return this.tripMapService.generateTripMap(dto);
    }

    /**
     * 🟢 NOVÝ ENDPOINT
     * Připravený pro OSM render mapy
     * FÁZE 1: AI planner pouze LOGUJEME
     */
    @Post("render-map")
    async renderMap(@Body() dto: GenerateTripMapDto) {

        // 🧠 FÁZE 1 – AI route planner (zatím jen plán + log)
        const aiPlan = await this.aiPlanner.plan(dto);
        this.logger.log(`AI ROUTE PLAN (phase 1): ${JSON.stringify(aiPlan)}`);

        // ─────────────────────────────
        // ⛔ DÁL ZATÍM NEMĚNÍME LOGIKU
        // ⛔ NEPOUŽÍVÁME aiPlan PRO RENDER
        // ─────────────────────────────

        // 1️⃣ Geocode from / to
        const from = await this.geocoding.geocode(dto.from);
        const to = await this.geocoding.geocode(dto.to);

        // 2️⃣ Geocode waypointy
        const stopNames = dto.stops ?? [];
        const stops: PointDto[] = [];

        for (const name of stopNames) {
            stops.push(await this.geocoding.geocode(name));
        }

        // 3️⃣ Transport (zatím 1. v poli)
        const transport = dto.transports[0];

        // 4️⃣ Výpočet ROUTY přes OSRM (už UMÍ waypointy)
        const route = await this.osrm.route(from, to, stops);

        // ⛔ Render zatím VYPÍNÁME (FÁZE 1)
        // ⛔ RenderTripMapDto se NETVOŘÍ

        return {
            phase: 1,
            aiPlan,
            info: "AI planner active, render disabled in phase 1"
        };
    }
}