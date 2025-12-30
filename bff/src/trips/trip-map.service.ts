import { Inject, Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";
import { GenerateTripMapDto } from "./dto/generate-trip-map.dto";
import { uploadTripMap } from "../storage/r2-upload";

@Injectable()
export class TripMapService {
    private readonly logger = new Logger(TripMapService.name);

    constructor(
        @Inject("OPENAI")
        private readonly openai: OpenAI
    ) {}

    async generateTripMap(
        dto: GenerateTripMapDto
    ): Promise<{ imageUrl: string }> {

        const prompt = this.buildPrompt(dto);

        try {
            // ✅ Images API – JEDINÁ SPRÁVNÁ CESTA PRO OBRÁZKY
            const img = await this.openai.images.generate({
                model: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
                prompt,
                size: "1024x1024", // ⛔ jiné rozměry NEJSOU povolené
            });

            const imageBase64 = img.data?.[0]?.b64_json;

            if (!imageBase64) {
                this.logger.error("OpenAI returned no image data", img);
                throw new Error("OpenAI did not return image data");
            }

            // 🔥 Upload do Cloudflare R2 → vrací VEŘEJNÉ URL
            const imageUrl = await uploadTripMap(imageBase64);

            return { imageUrl };

        } catch (err: any) {
            this.logger.error(
                "Trip map generation failed",
                err?.message ?? err
            );

            // přepošleme čitelnou chybu ven
            throw err;
        }
    }

    private buildPrompt(dto: GenerateTripMapDto): string {
        return `
Draw a clean, minimalist route map illustration for a travel app header.

Route:
- From: "${dto.from}"
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
