import { Inject, Injectable } from "@nestjs/common";
import OpenAI from "openai";
import { GenerateTripMapDto } from "./dto/generate-trip-map.dto";
import { uploadTripMap } from "../storage/r2-upload";

@Injectable()
export class TripMapService {
    constructor(@Inject("OPENAI") private readonly openai: OpenAI) {}

    async generateTripMap(dto: GenerateTripMapDto): Promise<{ imageUrl: string }> {
        const prompt = this.buildPrompt(dto);

        // ✅ Images API (správně)
        const img = await this.openai.images.generate({
            model: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
            prompt,
            size: "1024x1024", // ✅ POVOLENÁ HODNOTA
        });

        const imageBase64 = img.data?.[0]?.b64_json;

        if (!imageBase64) {
            throw new Error("OpenAI did not return image data");
        }

        // 🔥 upload do Cloudflare R2
        const imageUrl = await uploadTripMap(imageBase64);

        return { imageUrl };
    }

    private buildPrompt(dto: GenerateTripMapDto) {
        return `
Draw a clean minimalist route map illustration for a travel app header.

Route:
- From: "${dto.from}"
- To: "${dto.to}"
- Transport modes: ${dto.transports.join(", ")}

Style:
- dark background
- neon route line
- subtle map grid
- start & end pins
- no text, no watermark

Format:
- flat illustration
- centered composition
    `.trim();
    }
}

