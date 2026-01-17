import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { TripsService } from "./trips.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("Trips")
@ApiBearerAuth("jwt") // 👈 KLÍČOVÉ
@Controller("trips")
export class TripsController {
    constructor(
        private readonly tripsService: TripsService,
    ) {}

    // ─────────────────────────────
    // 📜 TRIP HISTORY – MY TRIPS
    // ─────────────────────────────
    @UseGuards(JwtAuthGuard)
    @Get("my")
    async getMyTrips(@Req() req) {
        return this.tripsService.getMyTrips(req.user.id);
    }
}