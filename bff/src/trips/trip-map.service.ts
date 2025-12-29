import { Inject, Injectable } from "@nestjs/common";
import OpenAI from "openai";
import { GenerateTripMapDto } from "./dto/generate-trip-map.dto";

@Injectable()
export class TripMapService {
    constructor(@Inject("OPENAI") private readonly openai: OpenAI) {
        console.log("OPENAI MODEL:", process.env.OPENAI_MODEL);
        console.log(
            "OPENAI KEY PRESENT:",
            !!process.env.OPENAI_API_KEY
        );
    }

    async generateTripMap(
        dto: GenerateTripMapDto
    ): Promise<{ imageBase64: string }> {

        const prompt = this.buildPrompt(dto);

        const response = await this.openai.responses.create({
            model: process.env.OPENAI_MODEL ?? "gpt-5",
            input: prompt,
            tools: [{ type: "image_generation" }],
            tool_choice: { type: "image_generation" },
        });

        const output = response.output?.[0];

        if (
            !output ||
            !("content" in output) ||
            !Array.isArray((output as any).content)
        ) {
            throw new Error("Invalid OpenAI response structure");
        }

        const imageBase64 = (output as any).content.find(
            (c: any) => c.type === "output_image"
        )?.image_base64;


        if (!imageBase64) {
            throw new Error("OpenAI did not return image data");
        }

        return { imageBase64 };
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
