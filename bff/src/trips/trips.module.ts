import { Module } from "@nestjs/common";
import { TripMapController } from "./trip-map.controller";
import { TripMapService } from "./trip-map.service";

@Module({
    controllers: [
        TripMapController, // ✅ JEN GENEROVÁNÍ MAPY
    ],
    providers: [
        TripMapService,
    ],
})
export class TripsModule {}
