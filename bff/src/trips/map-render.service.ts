import { Injectable } from "@nestjs/common";
import { chromium } from "playwright";
import { readFile } from "fs/promises";
import { join } from "path";
import type { LineString } from "geojson";

@Injectable()
export class MapRenderService {
    async renderToPng(route: LineString): Promise<Buffer> {
        // 1️⃣ Načti HTML šablonu
        const templatePath = join(
            process.cwd(),
            "src",
            "trips",
            "map-template.html"
        );

        let html = await readFile(templatePath, "utf-8");

        // 2️⃣ Vlož reálná OSRM data (JSON → string)
        html = html
            .replace("__ROUTE_GEOJSON__", JSON.stringify(route))
            .replace("__MAP_PADDING__", "0.2"); // 20 % padding
        
        // 3️⃣ Spusť Playwright (headless)
        const browser = await chromium.launch({
            headless: true,
            args: ["--no-sandbox"], // důležité pro Railway
        });

        const page = await browser.newPage({
            viewport: { width: 1600, height: 900 },
            deviceScaleFactor: 3, // hezčí PNG
        });

        // 4️⃣ Nahraj HTML přímo z paměti
        await page.setContent(html, { waitUntil: "load" });

        // 5️⃣ Počkej, až se načtou mapové dlaždice
        await page.waitForSelector(".leaflet-tile-loaded");

        // 6️⃣ Screenshot celé stránky
        const buffer = await page.screenshot({
            type: "png",
            fullPage: false
        });

        await browser.close();
        return buffer;
    }
}
