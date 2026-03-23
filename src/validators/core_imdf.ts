import fs from "fs/promises";
import path from "path";
import { ValidationIssue, IssueSeverity, IssueCode } from "../types/index.js";

// All 16 layers required by Google Maps Content Partners (GMCP)
const ALL_16_LAYERS = [
    "venue", "building", "footprint", "level", "unit",
    "fixture", "section", "geofence", "kiosk", "detail",
    "opening", "amenity", "anchor", "occupant", "address", "relationship"
];

// Layers that MUST have at least one feature (not just exist)
const NON_EMPTY_LAYERS = ["venue", "building", "footprint", "level", "unit"];

export async function validateImdfCore(datasetPath: string): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Check all 16 layers exist and are valid FeatureCollections
    for (const layer of ALL_16_LAYERS) {
        const filePath = path.join(datasetPath, `${layer}.geojson`);
        try {
            await fs.access(filePath);
        } catch {
            issues.push({
                severity: IssueSeverity.ERROR,
                code: IssueCode.MISSING_LAYER,
                layer: `${layer}.geojson`,
                message: `Required IMDF layer '${layer}.geojson' is missing (Google GMCP requires all 16 layers).`
            });
            continue;
        }

        let geojson: any;
        try {
            const data = await fs.readFile(filePath, "utf-8");
            geojson = JSON.parse(data);
        } catch (e: any) {
            issues.push({
                severity: IssueSeverity.ERROR,
                code: IssueCode.INVALID_GEOMETRY,
                layer: `${layer}.geojson`,
                message: `Failed to parse JSON: ${e.message}`
            });
            continue;
        }

        if (geojson.type !== "FeatureCollection") {
            issues.push({
                severity: IssueSeverity.ERROR,
                code: IssueCode.INVALID_GEOMETRY,
                layer: `${layer}.geojson`,
                message: `Root element must be a FeatureCollection (got '${geojson.type}').`
            });
        }

        // Warn on empty required layers
        if (NON_EMPTY_LAYERS.includes(layer) && (!geojson.features || geojson.features.length === 0)) {
            issues.push({
                severity: IssueSeverity.ERROR,
                code: IssueCode.EMPTY_REQUIRED_LAYER,
                layer: `${layer}.geojson`,
                message: `Layer '${layer}' must contain at least one feature.`
            });
        }
    }

    // Cross-reference: every unit must reference a valid level_id
    try {
        const levelPath = path.join(datasetPath, "level.geojson");
        const unitPath = path.join(datasetPath, "unit.geojson");
        const levelData = JSON.parse(await fs.readFile(levelPath, "utf-8").catch(() => '{"features":[]}'));
        const unitData = JSON.parse(await fs.readFile(unitPath, "utf-8").catch(() => '{"features":[]}'));

        const validLevelIds = new Set<string>(
            (levelData.features || []).map((f: any) => String(f.id))
        );

        for (const unit of (unitData.features || [])) {
            const levelId = unit.properties?.level_id;
            if (!levelId) {
                issues.push({
                    severity: IssueSeverity.ERROR,
                    code: IssueCode.INVALID_LEVEL_ID_REFERENCE,
                    layer: "unit.geojson",
                    feature_id: unit.id,
                    message: "Unit is missing required 'level_id' property."
                });
            } else if (!validLevelIds.has(String(levelId))) {
                issues.push({
                    severity: IssueSeverity.ERROR,
                    code: IssueCode.INVALID_LEVEL_ID_REFERENCE,
                    layer: "unit.geojson",
                    feature_id: unit.id,
                    message: `Unit references level_id '${levelId}' which does not exist in level.geojson.`
                });
            }
        }
    } catch { /* ignore file read errors — already reported as MISSING_LAYER */ }

    return issues;
}
