import { Body, Controller, Post } from "@nestjs/common";
import { GenerateTripMapDto } from "./dto/generate-trip-map.dto";
import { TripMapService } from "./trip-map.service";

@Controller("trips")
export class TripMapController {
    constructor(private readonly tripMapService: TripMapService) {}

    @Post("generate-map")
    async generate(@Body() dto: GenerateTripMapDto) {
        const { imageBase64 } = await this.tripMapService.generateTripMap(dto);

        // DOČASNĚ: vrátíme base64 (jen pro ověření end-to-end)
        // produkčně: uložíš do storage a vrátíš imageUrl
        return { imageBase64 };
    }
}
