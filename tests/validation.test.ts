import { validateImdfForGoogleHandler } from "../src/validators/google_profile.js";
import path from "path";

describe("IMDF Validation for Google Profile", () => {
    it("should pass a perfectly valid dataset", async () => {
        const result = await validateImdfForGoogleHandler({
            dataset_path: path.join(process.cwd(), "examples/sample-dataset/valid_imdf"),
            profile: "google_maps",
            fail_on: "error"
        });
        expect(result.status).toBe("pass");
        expect(result.summary.errors).toBe(0);
        expect(result.issues).toHaveLength(0);
    });

    it("should fail a misaligned dataset and suggest fixes", async () => {
        const result = await validateImdfForGoogleHandler({
            dataset_path: path.join(process.cwd(), "examples/sample-dataset/misaligned_imdf"),
            profile: "google_maps",
            fail_on: "error",
            alignment_options: {
                reference_footprint_path: path.join(process.cwd(), "examples/sample-dataset/misaligned_imdf/reference_footprint.geojson"),
                max_center_offset_meters: 20,
                max_area_ratio_diff: 0.3
            }
        });
        expect(result.status).toBe("fail");
        expect(result.summary.errors).toBeGreaterThan(0);
        
        const issueCodes = result.issues.map(i => i.code);
        expect(issueCodes).toContain("MISSING_CATEGORY");
        expect(issueCodes).toContain("MISSING_NAME");
        expect(issueCodes).toContain("CENTER_OFFSET_TOO_LARGE");
        expect(issueCodes).toContain("POI_OUTSIDE_FOOTPRINT");
        
        const fixCodes = result.suggested_fixes.map(f => f.code);
        expect(fixCodes).toContain("ADJUST_FOOTPRINT");
        expect(fixCodes).toContain("MOVE_POI_INSIDE_FOOTPRINT");
    });
});
