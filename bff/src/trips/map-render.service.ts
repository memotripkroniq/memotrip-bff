import { Injectable, Logger } from "@nestjs/common";
import { readFile } from "fs/promises";
import type { LineString } from "geojson";
import { join } from "path";
import { chromium } from "playwright";

type RenderState = {
    error?: string | null;
    ready?: boolean;
    reason?: string | null;
    routePathCount?: number;
    tileErrorCount?: number;
    tileLoadCount?: number;
};

@Injectable()
export class MapRenderService {
    private readonly logger = new Logger(MapRenderService.name);

    async renderToPng(
        route: LineString,
        opts?: { width?: number; height?: number }
    ): Promise<Buffer> {
        const templatePath = join(
            process.cwd(),
            "src",
            "trips",
            "map-template.html"
        );

        let html = await readFile(templatePath, "utf-8");
        html = html
            .replace("__ROUTE_GEOJSON__", JSON.stringify(route))
            .replace("__MAP_PADDING__", "0.2");

        const width = opts?.width ?? 1600;
        const height = opts?.height ?? 900;
        const renderId = `${width}x${height}-${Date.now()}`;

        this.logger.log(
            `[${renderId}] Starting map render with ${route.coordinates.length} route points (${width}x${height})`,
        );

        const browser = await chromium.launch({
            headless: true,
            args: ["--no-sandbox"],
        });

        try {
            const context = await browser.newContext({
                viewport: { width, height },
                deviceScaleFactor: 3,
                userAgent: "MemoTrip-Kroniq-Dev/1.0 (development contact: memotripkroniq@gmail.com)",
            });

            const page = await context.newPage();
            page.setDefaultTimeout(20_000);

            page.on("console", (msg) => {
                this.logger.log(`[${renderId}] browser console.${msg.type()}: ${msg.text()}`);
            });
            page.on("pageerror", (error) => {
                this.logger.error(`[${renderId}] browser pageerror: ${error.message}`, error.stack);
            });
            page.on("requestfailed", (request) => {
                const failureText = request.failure()?.errorText ?? "unknown";
                this.logger.warn(
                    `[${renderId}] request failed: ${request.method()} ${request.url()} -> ${failureText}`,
                );
            });

            this.logger.log(`[${renderId}] Setting inline HTML content from ${templatePath}`);
            await page.setContent(html, { waitUntil: "load" });

            this.logger.log(`[${renderId}] Waiting for #map container`);
            await page.waitForSelector("#map", { state: "visible" });

            this.logger.log(`[${renderId}] Waiting for route overlay path`);
            await page.waitForSelector(".leaflet-overlay-pane svg path", { state: "attached" });

            this.logger.log(`[${renderId}] Waiting for map readiness flag`);
            await page.waitForFunction(
                () => {
                    const state = (window as unknown as { __MAP_RENDER_STATE__?: RenderState }).__MAP_RENDER_STATE__;
                    return Boolean(state?.ready);
                },
                { timeout: 20_000 },
            );

            const renderState = await page.evaluate(() => {
                const state = (window as unknown as { __MAP_RENDER_STATE__?: RenderState }).__MAP_RENDER_STATE__;
                const mapEl = document.querySelector("#map") as HTMLElement | null;
                const routePaths = document.querySelectorAll(".leaflet-overlay-pane svg path").length;
                const loadedTiles = document.querySelectorAll(".leaflet-tile-loaded").length;

                return {
                    state: state ?? null,
                    routePaths,
                    loadedTiles,
                    mapSize: mapEl
                        ? {
                              width: mapEl.clientWidth,
                              height: mapEl.clientHeight,
                          }
                        : null,
                };
            });

            this.logger.log(
                `[${renderId}] Map ready: ${JSON.stringify(renderState)}`,
            );

            const mapLocator = page.locator("#map");
            const boundingBox = await mapLocator.boundingBox();
            if (!boundingBox) {
                throw new Error("Map element bounding box is null before screenshot");
            }

            this.logger.log(
                `[${renderId}] Taking screenshot of #map with bounding box ${JSON.stringify(boundingBox)}`,
            );

            return await mapLocator.screenshot({
                timeout: 60_000,
                type: "png",
            });
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.logger.error(`[${renderId}] Map render failed: ${err.message}`, err.stack);
            throw err;
        } finally {
            await browser.close();
        }
    }
}
