import {Inject, Injectable, Logger} from "@nestjs/common";
import { GenerateTripMapDto, TransportType } from "./dto/generate-trip-map.dto";
import { AiRoutePlanDto } from "./dto/ai-route-plan.dto";
import OpenAI from "openai";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

@Injectable()
export class AiRoutePlannerService {
    private readonly logger = new Logger(AiRoutePlannerService.name);

    constructor(
        @Inject("OPENAI")
        private readonly openai: OpenAI,
    ) {}

    async plan(dto: GenerateTripMapDto): Promise<AiRoutePlanDto> {

        // ─────────────────────────────
        // 🔁 FALLBACK (deterministický)
        // ─────────────────────────────
        const fallback = (): AiRoutePlanDto => {
            const points = [
                dto.from,
                ...(dto.stops ?? []),
                dto.to
            ];

            const transport = dto.transports[0];

            return {
                segments: points.slice(0, -1).map((p, i) => ({
                    from: p,
                    to: points[i + 1],
                    transport
                }))
            };
        };

        // ─────────────────────────────
        // 🧠 AI INPUT
        // ─────────────────────────────
        const input = {
            from: dto.from,
            stops: dto.stops ?? [],
            to: dto.to,
            allowedTransports: dto.transports,
        };

        try {
            const completion = await this.openai.chat.completions.create({
                model: "gpt-4.1-mini",
                temperature: 0,
                messages: [
                    {
                        role: "system",
                        content: `
You are a route planning assistant.

Rules:
- Do NOT invent places.
- Do NOT skip any point.
- Use ONLY provided place names.
- Use ONLY provided transport types.
- Return ONLY valid JSON matching this shape:

{
  "segments": [
    { "from": "...", "to": "...", "transport": "CAR|PLANE|..." }
  ]
}
`
                    },
                    {
                        role: "user",
                        content: JSON.stringify(input)
                    }
                ]
            });

            const content = completion.choices[0]?.message?.content;

            if (!content) {
                this.logger.warn("Empty AI response, using fallback");
                return fallback();
            }

            // ─────────────────────────────
            // 🧪 JSON PARSE
            // ─────────────────────────────
            let parsed: unknown;
            try {
                parsed = JSON.parse(content);
            } catch {
                this.logger.warn("AI returned non-JSON, using fallback");
                return fallback();
            }

            // ─────────────────────────────
            // ✅ VALIDACE DTO
            // ─────────────────────────────
            const plan = plainToInstance(AiRoutePlanDto, parsed);
            const errors = validateSync(plan, {
                whitelist: true,
                forbidNonWhitelisted: true,
            });

            if (errors.length > 0) {
                this.logger.warn("AI JSON failed validation, using fallback");
                return fallback();
            }

            return plan;

        } catch (err) {
            this.logger.error("AI route planner failed, using fallback", err);
            return fallback();
        }
    }
}
