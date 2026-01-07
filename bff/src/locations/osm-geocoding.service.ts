import {BadRequestException, Injectable} from "@nestjs/common";

export type GeoPoint = { lat: number; lon: number };

type NominatimResult = {
    lat: string;
    lon: string;
    display_name?: string;
};

@Injectable()
export class OsmGeocodingService {
    /**
     * Geocoding přes OSM Nominatim.
     * Vrací první (nejrelevantnější) výsledek.
     */
    async geocode(query: string): Promise<GeoPoint> {
        const q = query.trim();
        if (!q) throw new Error("Geocoding query is empty");

        const url =
            `https://nominatim.openstreetmap.org/search` +
            `?format=json&limit=1&q=${encodeURIComponent(q)}`;

        // Nominatim vyžaduje identifikovat se přes User-Agent/Referer
        // (na backendu ideálně nastav vlastní název appky)
        const res = await fetch(url, {
            headers: {
                "User-Agent": "MemoTripKroniQ/1.0 (geocoding; contact: support@memotrip.app)",
                "Accept": "application/json",
            },
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`Nominatim error: ${res.status} ${text}`);
        }

        const data = (await res.json()) as NominatimResult[];
        if (!data.length) {
            throw new BadRequestException({
                code: "GEOCODING_FAILED",
                message: `Location not found: ${query}`,
            });
        }

        const lat = Number(data[0].lat);
        const lon = Number(data[0].lon);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            throw new Error(`Invalid lat/lon from Nominatim for: ${query}`);
        }

        return { lat, lon };
    }
}