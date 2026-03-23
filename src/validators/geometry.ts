import { centroid, distance, area, booleanPointInPolygon } from "@turf/turf";
import { ValidationIssue, IssueSeverity, IssueCode } from "../types/index.js";

export function checkFootprintAlignment(venueFc: any, referenceFc: any, maxOffsetMeters: number, maxAreaDiff: number): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!venueFc.features || venueFc.features.length === 0) return issues;
    if (!referenceFc.features || referenceFc.features.length === 0) return issues;
    
    const venueGeom = venueFc.features[0];
    const refGeom = referenceFc.features[0];
    
    try {
        const c1 = centroid(venueGeom);
        const c2 = centroid(refGeom);
        // Distance in kilometers, convert to meters
        const distMeters = distance(c1, c2, { units: 'kilometers' }) * 1000;
        
        if (distMeters > maxOffsetMeters) {
            issues.push({
                severity: IssueSeverity.ERROR,
                code: IssueCode.CENTER_OFFSET_TOO_LARGE,
                layer: "venue.geojson",
                feature_id: venueGeom.id,
                message: `Venue centroid is offset by ${distMeters.toFixed(2)}m from reference (max ${maxOffsetMeters}m).`,
                details: { centroid_offset_meters: distMeters }
            });
        }
        
        const area1 = area(venueGeom);
        const area2 = area(refGeom);
        const diffRatio = Math.abs(area1 - area2) / area2;
        
        if (diffRatio > maxAreaDiff) {
            const code = area1 < area2 ? IssueCode.FLOOR_AREA_TOO_SMALL : IssueCode.FLOOR_AREA_TOO_LARGE;
            issues.push({
                severity: IssueSeverity.WARNING,
                code: code,
                layer: "venue.geojson",
                feature_id: venueGeom.id,
                message: `Venue area (${area1.toFixed(0)} sqm) differs by ${(diffRatio*100).toFixed(1)}% from reference (${area2.toFixed(0)} sqm).`,
                details: { area_ratio: diffRatio }
            });
        }
    } catch(e: any) {
        issues.push({
             severity: IssueSeverity.ERROR,
             code: IssueCode.INVALID_GEOMETRY,
             layer: "venue.geojson",
             message: `Failed turf geometry calculations: ${e.message}`
        });
    }
    return issues;
}

export function checkPoiOutsideFootprint(unitsFc: any, venueFc: any): ValidationIssue[] {
     const issues: ValidationIssue[] = [];
     if (!venueFc.features || venueFc.features.length === 0) return issues;
     const venuePoly = venueFc.features[0];

     for (const unit of unitsFc.features || []) {
         try {
             const c = centroid(unit);
             // simple point in polygon check
             if (!booleanPointInPolygon(c, venuePoly)) {
                  issues.push({
                      severity: IssueSeverity.WARNING,
                      code: IssueCode.POI_OUTSIDE_FOOTPRINT,
                      layer: "unit.geojson",
                      feature_id: unit.id,
                      message: `A unit's centroid falls outside the venue polygon boundaries.`
                  });
             }
         } catch(e) {}
     }
     return issues;
}
