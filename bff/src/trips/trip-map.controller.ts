import { Body, Controller, Post } from "@nestjs/common";
import { GenerateTripMapDto } from "./dto/generate-trip-map.dto";
import { TripMapService } from "./trip-map.service";

@Controller("trips")
export class TripMapController {
    constructor(private readonly tripMapService: TripMapService) {}

    @Post("generate-map")
    async generate(@Body() dto: GenerateTripMapDto) {
        return this.tripMapService.generateTripMap(dto);
    }
}
