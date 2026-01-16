import { Module } from "@nestjs/common";
import { TripMapController } from "./trip-map.controller";
import { TripsController } from "./trips.controller";
import { TripMapService } from "./trip-map.service";
import { TripsService } from "./trips.service";

import { OpenAIModule } from "../openai/openai.module";
import { OsmGeocodingService } from "../locations/osm-geocoding.service";
import { OsrmRoutingService } from "./osrm-routing.service";
import { MapRenderService } from "./map-render.service";
import { AiRoutePlannerService } from "./ai-route-planner.service";
import { PrismaService } from "../prisma/prisma.service";

@Module({
    imports: [
        OpenAIModule, // 🔥 musí zůstat (AI generate-map)
    ],
    controllers: [
        TripMapController,
        TripsController, // ✅ NOVÉ
    ],
    providers: [
        TripMapService,
        TripsService,    // ✅ NOVÉ
        PrismaService,   // ✅ NUTNÉ pro TripsService
        OsmGeocodingService,
        OsrmRoutingService,
        MapRenderService,
        AiRoutePlannerService,
    ],
})
export class TripsModule {}
