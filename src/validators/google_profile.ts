import fs from "fs/promises";
import path from "path";
import { ValidateImdfArgs, ValidationOutput, ValidationIssue, IssueSeverity, IssueCode, SuggestedFix } from "../types/index.js";
import { validateImdfCore } from "./core_imdf.js";
import { checkFootprintAlignment, checkPoiOutsideFootprint } from "./geometry.js";

export async function validateImdfForGoogleHandler(args: ValidateImdfArgs): Promise<ValidationOutput> {
    const issues: ValidationIssue[] = [];
    const fixes: SuggestedFix[] = [];
    let score = 100;
    
    // 1. Core structural validation
    const coreIssues = await validateImdfCore(args.dataset_path);
    issues.push(...coreIssues);

    let venueFc: any = null;
    let unitFc: any = null;
    
    // Load venue and unit if they exist
    try {
        venueFc = JSON.parse(await fs.readFile(path.join(args.dataset_path, "venue.geojson"), "utf-8"));
    } catch {}
    
    try {
        unitFc = JSON.parse(await fs.readFile(path.join(args.dataset_path, "unit.geojson"), "utf-8"));
    } catch {}

    // 2. Google Profile Specific Metadata Validation
    if (unitFc && unitFc.features) {
        for (const unit of unitFc.features) {
            const props = unit.properties || {};
            if (!props.name || (!props.name.en && !props.name.fi)) {
                issues.push({
                    severity: IssueSeverity.ERROR,
                    code: IssueCode.MISSING_NAME,
                    layer: "unit.geojson",
                    feature_id: unit.id,
                    message: "Google Maps requires at least one name translation (en or fi) for all Units."
                });
            }
            if (!props.category) {
                issues.push({
                    severity: IssueSeverity.ERROR,
                    code: IssueCode.MISSING_CATEGORY,
                    layer: "unit.geojson",
                    feature_id: unit.id,
                    message: "Category is required for Google Maps logic."
                });
            }
        }
    }

    // 3. Geometric Alignment (If options provided)
    if (args.alignment_options && args.alignment_options.reference_footprint_path && venueFc) {
        try {
            const refData = await fs.readFile(args.alignment_options.reference_footprint_path, "utf-8");
            const refFc = JSON.parse(refData);
            const geomIssues = checkFootprintAlignment(
                venueFc, 
                refFc, 
                args.alignment_options.max_center_offset_meters, 
                args.alignment_options.max_area_ratio_diff
            );
            issues.push(...geomIssues);
        } catch(e: any) {
            issues.push({
                severity: IssueSeverity.WARNING,
                code: IssueCode.INVALID_GEOMETRY,
                layer: "reference_footprint.geojson",
                message: `Failed to load reference layout: ${e.message}`
            });
        }
    }

    // POI out of footprint checks
    if (venueFc && unitFc) {
        const outIssues = checkPoiOutsideFootprint(unitFc, venueFc);
        issues.push(...outIssues);
    }
    
    // 4. Summarize and suggest fixes
    let errCount = 0;
    let warnCount = 0;
    for (const issue of issues) {
        if (issue.severity === IssueSeverity.ERROR) {
            errCount++;
            score -= 10;
        }
        if (issue.severity === IssueSeverity.WARNING) {
            warnCount++;
            score -= 2;
        }
    }

    if (issues.find(i => i.code === IssueCode.CENTER_OFFSET_TOO_LARGE)) {
        fixes.push({ code: "ADJUST_FOOTPRINT", message: "Trasladar venue.geojson para que coincida con el centroide de referencia." });
    }
    if (issues.find(i => i.code === IssueCode.POI_OUTSIDE_FOOTPRINT)) {
        fixes.push({ code: "MOVE_POI_INSIDE_FOOTPRINT", message: "Mover las geometrías de las Units para que no excedan el footprint del edificio." });
    }

    if (score < 0) score = 0;
    
    const isErrorFail = args.fail_on === "error" && errCount > 0;
    const isWarnFail = args.fail_on === "warning" && (errCount > 0 || warnCount > 0);
    const status = (isErrorFail || isWarnFail) ? "fail" : "pass";

    return {
        status,
        summary: { errors: errCount, warnings: warnCount, score },
        issues,
        suggested_fixes: fixes
    };
}
