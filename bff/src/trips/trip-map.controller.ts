import { Body, Controller, Post } from "@nestjs/common";
import { TripMapService } from "./trip-map.service";
import { GenerateTripMapDto } from "./dto/generate-trip-map.dto";
import { RenderTripMapDto } from "./dto/render-trip-map.dto";
import { OsmGeocodingService } from "../locations/osm-geocoding.service";
import { OsrmRoutingService } from "./osrm-routing.service";

@Controller("trips")
export class TripMapController {
    constructor(
        private readonly tripMapService: TripMapService,
        private readonly geocoding: OsmGeocodingService,
        private readonly osrm: OsrmRoutingService
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
    async renderMap(@Body() dto: GenerateTripMapDto) {
        const from = await this.geocoding.geocode(dto.from);
        const to = await this.geocoding.geocode(dto.to);

        const route = await this.osrm.route(from, to);

        const renderDto: RenderTripMapDto = {
            from,
            to,
            transport: dto.transports[0],
        };

        return this.tripMapService.renderTripMap(renderDto, route.geometry);
    }


}
