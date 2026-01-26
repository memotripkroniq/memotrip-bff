import { Inject, Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";
import { GenerateTripMapDto } from "./dto/generate-trip-map.dto";
import { uploadTripMap, uploadTripCover } from "../storage/r2-upload";
import { RenderTripMapDto } from "./dto/render-trip-map.dto";
import { MapRenderService } from "./map-render.service";
import { LineString } from "geojson";

@Injectable()
export class TripMapService {
    private readonly logger = new Logger(TripMapService.name);

    constructor(
        @Inject("OPENAI")
        private readonly openai: OpenAI,
        private readonly mapRender: MapRenderService,
    ) {}

    // ─────────────────────────────
    // 🎨 AI MAP (OPENAI)
    // ─────────────────────────────
    async generateTripMap(dto: GenerateTripMapDto): Promise<{ imageUrl: string }> {
        const prompt = this.buildPrompt(dto);

        try {
            const img = await this.openai.images.generate({
                model: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
                prompt,
                size: "1024x1024",
            });

            const imageBase64 = img.data?.[0]?.b64_json;
            if (!imageBase64) {
                throw new Error("OpenAI returned no image data");
            }

            // ✅ NECHÁNO: upload mapy zůstává přes uploadTripMap()
            const imageUrl = await this.uploadMapBase64(imageBase64);
            return { imageUrl };
        } catch (err: any) {
            this.logger.error("Trip map generation failed", err?.message ?? err);
            throw err;
        }
    }

    // ─────────────────────────────
    // 🗺️ MAP RENDER (OSM / ROUTE)
    // ─────────────────────────────
    async renderTripMap(dto: RenderTripMapDto, route: LineString): Promise<{ imageUrl: string }> {
        const pngBuffer = await this.mapRender.renderToPng(route);
        const imageBase64 = pngBuffer.toString("base64");

        // ✅ NECHÁNO: upload mapy zůstává přes uploadTripMap()
        const imageUrl = await this.uploadMapBase64(imageBase64);
        return { imageUrl };
    }

    // ─────────────────────────────
    // 🖼️ (VOLITELNÉ) COVER BASE64 UPLOAD DO R2
    //  - nijak to nesouvisí s Android multipart endpointem
    //  - jen připravené do budoucna
    // ─────────────────────────────
    async uploadCoverBase64(imageBase64: string, ext: "jpg" | "png" = "jpg"): Promise<{ imageUrl: string }> {
        const buffer = Buffer.from(imageBase64, "base64");
        const imageUrl = await uploadTripCover(buffer, ext);

        return { imageUrl };
    }

    // ✅ Helper – mapy pořád používají původní uploadTripMap()
    private async uploadMapBase64(imageBase64: string): Promise<string> {
        return uploadTripMap(imageBase64);
    }

    // ─────────────────────────────
    // 🧠 PROMPT
    // ─────────────────────────────
    private buildPrompt(dto: GenerateTripMapDto): string {
        const stops = dto.stops ?? [];
        return `
Draw a clean, minimalist route map illustration for a travel app header.

Route:
- From: "${dto.from}"
- ${stops.length ? `Stops: ${stops.join(" → ")}` : ""}
- To: "${dto.to}"
- Transport modes: ${dto.transports.join(", ")}

Visual style:
- dark background
- glowing neon route line
- subtle map grid
- simple start & end location pins
- flat, modern UI illustration

Rules:
- no text
- no labels
- no watermark
- no logos

Output:
- flat illustration
- centered composition
    `.trim();
    }
}
