import { Body, Controller, Get, Post, Req, UploadedFile, UseGuards, UseInterceptors, BadRequestException, Param, NotFoundException, Delete, Patch } from "@nestjs/common";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags, ApiBody, ApiOkResponse, ApiCreatedResponse } from "@nestjs/swagger";
import { TripsService } from "./trips.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateTripDto } from "./dto/create-trip.dto";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import type { Express } from "express";
import { UpdateTripDetailDto } from "./dto/update-trip-detail.dto";
import { TripPhotosResponseDto } from "./dto/trip-photos-response.dto";
import { UploadTripPhotoResponseDto } from "./dto/upload-trip-photo-response.dto";
import { CreateTripPhotoCategoryDto } from "./dto/create-trip-photo-category.dto";
import { CreateTripPhotoCategoryResponseDto } from "./dto/create-trip-photo-category-response.dto";
import { UpdateTripPhotoCategoryDto } from "./dto/update-trip-photo-category.dto";
import { UpdateTripPhotoDto } from "./dto/update-trip-photo.dto";
import { DeleteSuccessDto } from "./dto/delete-success.dto";
import { TripDetailResponseDto } from "./dto/trip-detail-response.dto";
import { TripKroniqShareResponseDto } from "./dto/trip-kroniq-share-response.dto";
import { TripPhotoLimitResponseDto } from "./dto/trip-photo-limit-response.dto";


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
    // 🔎 TRIP DETAIL
    // ─────────────────────────────
    @UseGuards(JwtAuthGuard)
    @Get(":tripId")
    @ApiOkResponse({ type: TripDetailResponseDto })
    async getTripDetail(@Req() req, @Param("tripId") tripId: string) {
        const trip = await this.tripsService.getTripDetail(req.user.sub, tripId);
        if (!trip) throw new NotFoundException("Trip not found");
        return trip;
    }

    @UseGuards(JwtAuthGuard)
    @Patch(":tripId")
    @ApiOperation({ summary: "Update trip detail (budget, checklist, notes, tips)" })
    async updateTripDetail(
        @Req() req,
        @Param("tripId") tripId: string,
        @Body() dto: UpdateTripDetailDto,
    ) {
        const trip = await this.tripsService.updateTripDetail(req.user.sub, tripId, dto);
        if (!trip) throw new NotFoundException("Trip not found");
        return trip;
    }

    // ─────────────────────────────
    // ✅ DETELE TRIP
    // ─────────────────────────────
    @UseGuards(JwtAuthGuard)
    @Delete(":tripId")
    @ApiOperation({ summary: "Delete trip" })
    async deleteTrip(
        @Req() req,
        @Param("tripId") tripId: string,
    ) {
        const result = await this.tripsService.deleteTrip(req.user.sub, tripId);
        if (!result) throw new NotFoundException("Trip not found");
        return result;
    }

    @UseGuards(JwtAuthGuard)
    @Get(":tripId/limits/photos")
    @ApiOperation({ summary: "Get trip photo upload limit" })
    @ApiOkResponse({ type: TripPhotoLimitResponseDto })
    async getTripPhotoLimits(@Req() req, @Param("tripId") tripId: string) {
        return this.tripsService.getTripPhotoLimits(req.user.sub, tripId);
    }

    @UseGuards(JwtAuthGuard)
    @Get(":tripId/photos")
    @ApiOperation({ summary: "Get trip photo gallery" })
    @ApiOkResponse({ type: TripPhotosResponseDto })
    async getTripPhotos(@Req() req, @Param("tripId") tripId: string) {
        return this.tripsService.getTripPhotos(req.user.sub, tripId);
    }

    @UseGuards(JwtAuthGuard)
    @Post(":tripId/photos")
    @ApiOperation({ summary: "Upload trip gallery photo" })
    @ApiConsumes("multipart/form-data")
    @ApiCreatedResponse({ type: UploadTripPhotoResponseDto })
    @ApiBody({
        schema: {
            type: "object",
            properties: {
                file: { type: "string", format: "binary" },
                categoryId: { type: "string", nullable: true },
            },
            required: ["file"],
        },
    })
    @UseInterceptors(FileInterceptor("file", { storage: memoryStorage() }))
    async uploadTripPhoto(
        @Req() req,
        @Param("tripId") tripId: string,
        @UploadedFile() file: Express.Multer.File,
        @Body("categoryId") categoryId?: string,
    ) {
        if (!file) {
            throw new BadRequestException("Missing file field (multipart name must be 'file')");
        }

        return this.tripsService.uploadTripPhoto(req.user.sub, tripId, file, categoryId);
    }

    @UseGuards(JwtAuthGuard)
    @Patch(":tripId/photos/:photoId")
    @ApiOperation({ summary: "Update trip gallery photo" })
    @ApiOkResponse({ type: UploadTripPhotoResponseDto })
    async updateTripPhoto(
        @Req() req,
        @Param("tripId") tripId: string,
        @Param("photoId") photoId: string,
        @Body() dto: UpdateTripPhotoDto,
    ) {
        return this.tripsService.updateTripPhoto(req.user.sub, tripId, photoId, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Delete(":tripId/photos/:photoId")
    @ApiOperation({ summary: "Delete trip gallery photo" })
    @ApiOkResponse({ type: DeleteSuccessDto })
    async deleteTripPhoto(
        @Req() req,
        @Param("tripId") tripId: string,
        @Param("photoId") photoId: string,
    ) {
        return this.tripsService.deleteTripPhoto(req.user.sub, tripId, photoId);
    }

    @UseGuards(JwtAuthGuard)
    @Post(":tripId/photo-categories")
    @ApiOperation({ summary: "Create trip photo category" })
    @ApiCreatedResponse({ type: CreateTripPhotoCategoryResponseDto })
    async createTripPhotoCategory(
        @Req() req,
        @Param("tripId") tripId: string,
        @Body() dto: CreateTripPhotoCategoryDto,
    ) {
        return this.tripsService.createTripPhotoCategory(req.user.sub, tripId, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Patch(":tripId/photo-categories/:categoryId")
    @ApiOperation({ summary: "Rename trip photo category" })
    @ApiOkResponse({ type: CreateTripPhotoCategoryResponseDto })
    async updateTripPhotoCategory(
        @Req() req,
        @Param("tripId") tripId: string,
        @Param("categoryId") categoryId: string,
        @Body() dto: UpdateTripPhotoCategoryDto,
    ) {
        return this.tripsService.renameTripPhotoCategory(req.user.sub, tripId, categoryId, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Delete(":tripId/photo-categories/:categoryId")
    @ApiOperation({ summary: "Delete trip photo category and move photos to default category" })
    @ApiOkResponse({ type: DeleteSuccessDto })
    async deleteTripPhotoCategory(
        @Req() req,
        @Param("tripId") tripId: string,
        @Param("categoryId") categoryId: string,
    ) {
        return this.tripsService.deleteTripPhotoCategory(req.user.sub, tripId, categoryId);
    }

    @UseGuards(JwtAuthGuard)
    @Post(":tripId/kroniq-share")
    @ApiOperation({ summary: "Share trip with all current KroniQ participants" })
    @ApiOkResponse({ type: TripKroniqShareResponseDto })
    async shareTripInKroniq(
        @Req() req,
        @Param("tripId") tripId: string,
    ) {
        return this.tripsService.shareTripInKroniq(req.user.sub, tripId);
    }

    @UseGuards(JwtAuthGuard)
    @Delete(":tripId/kroniq-share")
    @ApiOperation({ summary: "Remove KroniQ sharing for this trip" })
    @ApiOkResponse({ type: TripKroniqShareResponseDto })
    async unshareTripInKroniq(
        @Req() req,
        @Param("tripId") tripId: string,
    ) {
        return this.tripsService.unshareTripInKroniq(req.user.sub, tripId);
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

        const coverImageUrl = await this.tripsService.uploadCoverImage(req.user.sub, file);
        return { coverImageUrl };
    }

}
