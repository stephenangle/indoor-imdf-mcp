import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { ExtractFloorPlanArgs } from "../types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = path.join(__dirname, "../../scripts/extract_pdf.py");

const ALL_16_LAYERS = [
    "venue", "building", "footprint", "level", "unit",
    "fixture", "section", "geofence", "kiosk", "detail",
    "opening", "amenity", "anchor", "occupant", "address", "relationship"
];

type BBox = [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]

/**
 * Runs the Python PDF extractor as a subprocess, then applies
 * georeferencing against the provided venue footprint polygon.
 * Writes all 16 IMDF GeoJSON layers to output_dataset_path.
 */
export async function extractFloorPlan(args: ExtractFloorPlanArgs) {
    // --- Validate inputs ---
    try {
        await fs.access(args.pdf_path);
    } catch {
        throw new Error(`PDF not found at: ${args.pdf_path}`);
    }

    // Compute venue bounding box from footprint
    const venueFeature = args.venue_footprint_geojson?.features?.[0];
    if (!venueFeature?.geometry?.coordinates) {
        throw new Error("venue_footprint_geojson must contain at least one polygon Feature.");
    }
    const venueBbox = computeBbox(venueFeature.geometry.coordinates[0] as number[][]);
    const [minLng, minLat, maxLng, maxLat] = venueBbox;
    const lngSpan = maxLng - minLng;
    const latSpan = maxLat - minLat;

    // --- Run Python extraction ---
    const tmpOutput = path.join(path.dirname(args.pdf_path), `_imdf_extract_${Date.now()}.json`);
    const pages = args.pages.join(",");

    const pythonResult = await runPython([
        "--pdf", args.pdf_path,
        "--pages", pages,
        "--output", tmpOutput
    ]);

    if (!pythonResult.success) {
        throw new Error(`PDF extraction failed: ${pythonResult.error}`);
    }

    // Read extracted polygons
    const extracted = JSON.parse(await fs.readFile(tmpOutput, "utf-8"));
    await fs.unlink(tmpOutput).catch(() => {});

    if (extracted.error) {
        throw new Error(`Python extractor error: ${extracted.error}`);
    }

    // --- Build output directory ---
    await fs.mkdir(args.output_dataset_path, { recursive: true });

    const venueName = args.venue_name || "Venue";
    const venueId = "venue-01";
    const buildingId = "building-01";
    const footprintId = "footprint-01";

    // --- Write venue, building, footprint, address ---
    const venueProps = {
        feature_type: "venue",
        name: { en: venueName },
        category: "venue",
        address_id: "address-01"
    };
    await writeLayer(args.output_dataset_path, "venue", [{
        type: "Feature", id: venueId,
        geometry: venueFeature.geometry,
        properties: venueProps
    }]);

    await writeLayer(args.output_dataset_path, "building", [{
        type: "Feature", id: buildingId,
        geometry: null, // Building is unlocated per IMDF spec
        properties: { feature_type: "building", name: { en: venueName }, address_id: "address-01" }
    }]);

    await writeLayer(args.output_dataset_path, "footprint", [{
        type: "Feature", id: footprintId,
        geometry: venueFeature.geometry,
        properties: { feature_type: "footprint", building_ids: [buildingId], category: "ground" }
    }]);

    await writeLayer(args.output_dataset_path, "address", [{
        type: "Feature", id: "address-01",
        geometry: null,
        properties: {
            feature_type: "address",
            address: venueFeature.properties?.address || "",
            locality: "",
            country: ""
        }
    }]);

    // --- Process levels and units ---
    const levels = extracted.levels as Record<string, any>;
    const levelIds: string[] = [];
    const units: any[] = [];

    let levelIndex = 0;
    for (const [levelKey, levelData] of Object.entries(levels)) {
        const levelId = `level-${levelIndex + 1}`;
        levelIds.push(levelId);
        const levelName = args.level_names?.[levelIndex] || `Level ${levelIndex + 1}`;

        // Georeference: map normalized [0,1] coords → real WGS84 coords
        const geoRefPolygons = (levelData.polygons as number[][][][]).map(rings =>
            rings.map(ring =>
                ring.map(([nx, ny]) => [
                    minLng + nx * lngSpan,
                    maxLat - ny * latSpan   // flip Y: PDF origin is top-left, geo is bottom-left
                ])
            )
        );

        // Write level feature
        const levelFeature = {
            type: "Feature", id: levelId,
            geometry: venueFeature.geometry, // Level extent = venue extent
            properties: {
                feature_type: "level",
                ordinal: levelIndex,
                name: { en: levelName },
                short_name: { en: String(levelIndex + 1) },
                building_ids: [buildingId]
            }
        };

        // Build unit features
        let unitIdx = 0;
        for (const rings of geoRefPolygons) {
            if (rings.length === 0) continue;
            const unitId = `unit-${levelId}-${unitIdx}`;
            units.push({
                type: "Feature", id: unitId,
                geometry: { type: "Polygon", coordinates: rings },
                properties: {
                    feature_type: "unit",
                    level_id: levelId,
                    category: "room",
                    name: { en: `${levelName} Space ${unitIdx + 1}` },
                    restriction: "public"
                }
            });
            unitIdx++;
        }

        // Write level individually (accumulate all, write after loop)  
        if (levelIndex === 0) {
            await writeLayer(args.output_dataset_path, "level", [levelFeature]);
        } else {
            // Append to existing level file
            const existing = JSON.parse(await fs.readFile(
                path.join(args.output_dataset_path, "level.geojson"), "utf-8"
            ));
            existing.features.push(levelFeature);
            await fs.writeFile(
                path.join(args.output_dataset_path, "level.geojson"),
                JSON.stringify(existing, null, 2), "utf-8"
            );
        }

        levelIndex++;
    }

    await writeLayer(args.output_dataset_path, "unit", units);

    // --- Write empty required layers ---
    const emptyLayers = ["fixture", "section", "geofence", "kiosk", "detail",
                         "opening", "amenity", "anchor", "occupant", "relationship"];
    for (const layer of emptyLayers) {
        await writeLayer(args.output_dataset_path, layer, []);
    }

    // --- manifest.json ---
    await fs.writeFile(
        path.join(args.output_dataset_path, "manifest.json"),
        JSON.stringify({ version: "1.0.0", language: "en", created: new Date().toISOString() }, null, 2),
        "utf-8"
    );

    return {
        success: true,
        output_dataset_path: args.output_dataset_path,
        levels_extracted: levelIndex,
        units_extracted: units.length,
        layers_written: ALL_16_LAYERS.length,
        message: `Extracted ${units.length} units across ${levelIndex} levels. All 16 IMDF layers written to ${args.output_dataset_path}`
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeBbox(coords: number[][]): BBox {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const [lng, lat] of coords) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
    }
    return [minLng, minLat, maxLng, maxLat];
}

async function writeLayer(dir: string, name: string, features: any[]) {
    const fc = { type: "FeatureCollection", features };
    await fs.writeFile(path.join(dir, `${name}.geojson`), JSON.stringify(fc, null, 2), "utf-8");
}

function runPython(scriptArgs: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
        const proc = spawn("python3", [PYTHON_SCRIPT, ...scriptArgs]);
        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (data) => { stdout += data.toString(); });
        proc.stderr.on("data", (data) => { stderr += data.toString(); });

        proc.on("close", (code) => {
            try {
                const result = JSON.parse(stdout.trim());
                resolve(result);
            } catch {
                if (code !== 0) {
                    reject(new Error(`Python exited with code ${code}. stderr: ${stderr}`));
                } else {
                    resolve({ success: true, raw: stdout });
                }
            }
        });

        proc.on("error", (err) => {
            reject(new Error(`Failed to start Python: ${err.message}. Is python3 in PATH?`));
        });
    });
}
