import {Body, Controller, Get, Post, Req, UseGuards} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { TripsService } from "./trips.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import {CreateTripDto} from "./dto/create-trip.dto";

@ApiTags("Trips")
@ApiBearerAuth("jwt") // 👈 KLÍČOVÉ
@Controller("trips")
export class TripsController {
    constructor(
        private readonly tripsService: TripsService,
    ) {}

    // ─────────────────────────────
    // ➕ CREATE TRIP
    // ─────────────────────────────
    @UseGuards(JwtAuthGuard)
    @Post()
    async createTrip(
        @Req() req,
        @Body() dto: CreateTripDto,
    ) {
        return this.tripsService.createTrip(
            req.user.id,
            dto,
        );
    }

    // ─────────────────────────────
    // 📜 TRIP HISTORY – MY TRIPS
    // ─────────────────────────────
    @UseGuards(JwtAuthGuard)
    @Get("my")
    async getMyTrips(@Req() req) {
        return this.tripsService.getMyTrips(req.user.id);
    }
}