import { Module } from "@nestjs/common";
import { TripMapController } from "./trip-map.controller";
import { TripMapService } from "./trip-map.service";
import { OpenAIModule } from "../openai/openai.module";

@Module({
    imports: [
        OpenAIModule, // 🔥 TOTO JE KLÍČ
    ],
    controllers: [
        TripMapController, // ✅ JEN GENEROVÁNÍ MAPY
    ],
    providers: [
        TripMapService,
    ],
})
export class TripsModule {}
