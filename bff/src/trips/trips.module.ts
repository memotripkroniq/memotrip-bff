import { Module } from "@nestjs/common";
import { TripMapController } from "./trip-map.controller";
import { TripMapService } from "./trip-map.service";
import { OpenAIModule } from "../openai/openai.module";
import { OsmGeocodingService } from "../locations/osm-geocoding.service";
import { OsrmRoutingService } from "./osrm-routing.service";
import { MapRenderService } from "./map-render.service";

@Module({
    imports: [
        OpenAIModule, // 🔥 musí zůstat (AI generate-map)
    ],
    controllers: [
        TripMapController,
    ],
    providers: [
        TripMapService,
        OsmGeocodingService,
        OsrmRoutingService,
        MapRenderService,
    ],
})
export class TripsModule {}
