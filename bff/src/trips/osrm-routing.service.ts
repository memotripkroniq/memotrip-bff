import { Injectable } from "@nestjs/common";

export type OsrmRouteResult = {
    distance: number; // meters
    duration: number; // seconds
    geometry: GeoJSON.LineString;
};

type OsrmResponse = {
    routes: Array<{
        distance: number;
        duration: number;
        geometry: {
            coordinates: [number, number][]; // [lon, lat]
            type: "LineString";
        };
    }>;
};

type Coordinate = { lat: number; lon: number }; // 🆕 sjednocený typ

@Injectable()
export class OsrmRoutingService {
    private readonly baseUrl = "https://router.project-osrm.org";

    async route(
        from: Coordinate,
        to: Coordinate,
        stops: Coordinate[] = [] // 🆕 waypointy (nepovinné)
    ): Promise<OsrmRouteResult> {

        // 🆕 připravená struktura bodů (zatím NEPOUŽITÁ v URL)
        const points: Coordinate[] = [
            from,
            ...stops,
            to
        ];

        // 🆕 OSRM očekává "lon,lat;lon,lat;..."
        const coordinates = points
            .map(p => `${p.lon},${p.lat}`)
            .join(";");


        // 🆕 waypointy jsou AKTIVNĚ použité
        const url =
            `${this.baseUrl}/route/v1/driving/${coordinates}` +
            `?overview=full&geometries=geojson`;

        const res = await fetch(url);

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`OSRM error: ${res.status} ${text}`);
        }

        const data = (await res.json()) as OsrmResponse;

        if (!data.routes?.length) {
            throw new Error("OSRM returned no routes");
        }

        const route = data.routes[0];

        return {
            distance: route.distance,
            duration: route.duration,
            geometry: route.geometry as GeoJSON.LineString,
        };
    }
}
