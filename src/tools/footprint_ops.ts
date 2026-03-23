import fs from "fs/promises";
import { AcquireFootprintArgs } from "../types/index.js";

const GOOGLE_PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const OSM_OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/**
 * Queries Google Places API (New) for venue coordinates,
 * then fetches the building polygon from OSM Overpass.
 * Falls back to a bounding-box polygon if Overpass returns nothing.
 */
export async function acquireFootprint(args: AcquireFootprintArgs) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
        throw new Error("GOOGLE_MAPS_API_KEY environment variable is not set.");
    }

    // --- Step 1: Google Places API (New) — find venue lat/lng ---
    const placesPayload = {
        textQuery: args.query,
        ...(args.country_code ? { locationBias: { circle: { radius: 50000 } } } : {})
    };

    const placesRes = await fetch(GOOGLE_PLACES_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": "places.displayName,places.location,places.formattedAddress,places.id,places.types"
        },
        body: JSON.stringify(placesPayload)
    });

    if (!placesRes.ok) {
        const body = await placesRes.text();
        throw new Error(`Google Places API error ${placesRes.status}: ${body}`);
    }

    const placesData = await placesRes.json() as any;
    if (!placesData.places || placesData.places.length === 0) {
        throw new Error(`No places found for query: "${args.query}"`);
    }

    const place = placesData.places[0];
    const lat: number = place.location.latitude;
    const lng: number = place.location.longitude;
    const venueName: string = place.displayName?.text || args.query;
    const formattedAddress: string = place.formattedAddress || "";

    // --- Step 2: OSM Overpass — fetch building polygon ---
    // Search radius: 150m around the venue center
    const delta = 0.0015; // ~150m
    const bbox = `${lat - delta},${lng - delta},${lat + delta},${lng + delta}`;
    const overpassQuery = `[out:json][timeout:25];(way["building"](${bbox});relation["building"](${bbox}););out geom;`;

    let footprintGeojson: any = null;
    let source = "google+osm";

    try {
        const osmRes = await fetch(OSM_OVERPASS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `data=${encodeURIComponent(overpassQuery)}`
        });

        if (osmRes.ok) {
            const osmData = await osmRes.json() as any;
            const elements = osmData.elements || [];

            // Find the largest building polygon (most likely the venue itself)
            let bestWay: any = null;
            let bestArea = 0;

            for (const el of elements) {
                if (el.type === "way" && el.geometry && el.geometry.length > 2) {
                    // Approximate area via shoelace
                    const coords = el.geometry.map((pt: any) => [pt.lon, pt.lat]);
                    const area = Math.abs(coords.reduce((acc: number, c: number[], i: number) => {
                        const next = coords[(i + 1) % coords.length];
                        return acc + c[0] * next[1] - next[0] * c[1];
                    }, 0)) / 2;
                    if (area > bestArea) {
                        bestArea = area;
                        bestWay = el;
                    }
                }
            }

            if (bestWay) {
                const coords = bestWay.geometry.map((pt: any) => [pt.lon, pt.lat]);
                // Close the ring if needed
                if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
                    coords.push(coords[0]);
                }
                footprintGeojson = {
                    type: "FeatureCollection",
                    features: [{
                        type: "Feature",
                        id: `osm-way-${bestWay.id}`,
                        geometry: { type: "Polygon", coordinates: [coords] },
                        properties: {
                            name: venueName,
                            address: formattedAddress,
                            osm_id: bestWay.id,
                            source: "osm"
                        }
                    }]
                };
            }
        }
    } catch (osmErr: any) {
        // OSM failed — fall through to bounding-box fallback
        source = "google_bbox_fallback";
    }

    // --- Fallback: bounding-box polygon from Google lat/lng ---
    if (!footprintGeojson) {
        source = "google_bbox_fallback";
        const d = 0.0003; // ~30m box
        footprintGeojson = {
            type: "FeatureCollection",
            features: [{
                type: "Feature",
                id: "google-bbox-fallback",
                geometry: {
                    type: "Polygon",
                    coordinates: [[
                        [lng - d, lat - d], [lng + d, lat - d],
                        [lng + d, lat + d], [lng - d, lat + d],
                        [lng - d, lat - d]
                    ]]
                },
                properties: {
                    name: venueName,
                    address: formattedAddress,
                    source: "google_bbox_fallback",
                    warning: "No OSM building polygon found. This is an approximate bounding box."
                }
            }]
        };
    }

    // --- Step 3: Optionally save to disk ---
    if (args.output_path) {
        await fs.writeFile(args.output_path, JSON.stringify(footprintGeojson, null, 2), "utf-8");
    }

    const centroid = footprintGeojson.features[0].geometry.coordinates[0].reduce(
        (acc: number[], c: number[]) => [acc[0] + c[0], acc[1] + c[1]],
        [0, 0]
    ).map((v: number) => v / footprintGeojson.features[0].geometry.coordinates[0].length);

    return {
        success: true,
        source,
        venue_name: venueName,
        formatted_address: formattedAddress,
        centroid_lng_lat: centroid,
        geojson: footprintGeojson,
        saved_to: args.output_path || null
    };
}
