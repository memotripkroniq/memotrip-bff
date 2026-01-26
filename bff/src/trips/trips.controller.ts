import { Body, Controller, Get, Post, Req, UploadedFile, UseGuards, UseInterceptors, BadRequestException } from "@nestjs/common";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags, ApiBody } from "@nestjs/swagger";
import { TripsService } from "./trips.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateTripDto } from "./dto/create-trip.dto";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import type { Express } from "express";


type UploadedImage = {
    originalname: string;
    mimetype: string;
    buffer: Buffer;
};


@ApiTags("Trips")
@ApiBearerAuth("jwt")
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
    @ApiOperation({ summary: "Create new trip" })
    async createTrip(
        @Req() req,
        @Body() dto: CreateTripDto,
    ) {
        return this.tripsService.createTrip(req.user.sub, dto);
    }

    // ─────────────────────────────
    // 📜 TRIP HISTORY – MY TRIPS
    // ─────────────────────────────
    @UseGuards(JwtAuthGuard)
    @Get("my")
    async getMyTrips(@Req() req) {
        return this.tripsService.getMyTrips(req.user.sub);
    }

    // ─────────────────────────────
    // ✅ COVER UPLOAD
    // ─────────────────────────────
    @UseGuards(JwtAuthGuard)
    @Post("cover")
    @ApiOperation({ summary: "Upload trip cover image" })
    @ApiConsumes("multipart/form-data")
    @ApiBody({
        schema: {
            type: "object",
            properties: {
                file: { type: "string", format: "binary" },
            },
            required: ["file"],
        },
    })
    @UseInterceptors(FileInterceptor("file", { storage: memoryStorage() }))
    async uploadCover(@Req() req, @UploadedFile() file: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException("Missing file field (multipart name must be 'file')");
        }

        const url = await this.tripsService.uploadCoverImage(req.user.sub, file);
        return { url };
    }

}