import { Inject, Injectable } from "@nestjs/common";
import OpenAI from "openai";
import { GenerateTripMapDto } from "./dto/generate-trip-map.dto";
import { uploadTripMap } from "../storage/r2-upload";

@Injectable()
export class TripMapService {
    constructor(@Inject("OPENAI") private readonly openai: OpenAI) {}

    async generateTripMap(dto: GenerateTripMapDto): Promise<{ imageUrl: string }> {

        const prompt = this.buildPrompt(dto);

        const response = await this.openai.responses.create({
            model: "gpt-image-1",
            input: prompt,
            tools: [{ type: "image_generation" }],
            tool_choice: { type: "image_generation" },
        });

        const imageBase64 = response.output
            ?.flatMap((item: any) => item.content ?? [])
            .find((c: any) => c.type === "output_image")
            ?.image_base64;


        if (!imageBase64) {
            throw new Error("OpenAI did not return image data");
        }

        // 🔥 ULOŽENÍ DO R2
        const imageUrl = await uploadTripMap(imageBase64);

        return { imageUrl };
    }

    private buildPrompt(dto: GenerateTripMapDto) {
        const transports = dto.transports.join(", ");

        return `
Draw a clean minimalist "route map" banner illustration (like a travel app header).
- From: "${dto.from}"
- To: "${dto.to}"
- Transport modes: ${transports}
Style:
- dark background, neon route line, subtle map grid
- include start/end pins + a simple route line
- no extra text, no watermark
Output: 1024x512 PNG
`.trim();
    }
}
