import { Body, Controller, Post } from "@nestjs/common";
import { TripMapService } from "./trip-map.service";
import { GenerateTripMapDto } from "./dto/generate-trip-map.dto";
import { RenderTripMapDto } from "./dto/render-trip-map.dto";

@Controller("trips")
export class TripMapController {
    constructor(
        private readonly tripMapService: TripMapService
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
     */
    @Post("render-map")
    async renderMap(
        @Body() dto: GenerateTripMapDto
    ) {
        // 🔧 ZATÍM DUMMY SOUŘADNICE
        // (v dalším kroku nahradíme OSM geocodingem)
        const renderDto: RenderTripMapDto = {
            from: {
                lat: 48.1486,   // Bratislava
                lon: 17.1077,
            },
            to: {
                lat: 41.3851,   // Barcelona
                lon: 2.1734,
            },
            // vezmeme první zvolený transport
            transport: dto.transports[0],
        };

        return this.tripMapService.renderTripMap(renderDto);
    }
}
