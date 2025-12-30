import { Module } from "@nestjs/common";
import { TripMapController } from "./trip-map.controller";
import { TripMapService } from "./trip-map.service";
import { OpenAIModule } from "../openai/openai.module";
import { OsmGeocodingService } from "../locations/osm-geocoding.service";

@Module({
    imports: [
        OpenAIModule, // 🔥 musí zůstat (AI generate-map)
    ],
    controllers: [
        TripMapController,
    ],
    providers: [
        TripMapService,
        OsmGeocodingService, // 🟢 KROK 3 – OSM geocoding
    ],
})
export class TripsModule {}
