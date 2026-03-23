import { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import {
    ValidateImdfSchema, ReadLayerSchema, WriteLayerSchema,
    ListDatasetsSchema, PackageZipSchema,
    AcquireFootprintSchema, ExtractFloorPlanSchema
} from "../types/index.js";
import { listIndoorDatasets, readGeojsonLayer, writeGeojsonLayer } from "./file_ops.js";
import { packageImdfZip } from "./zip_ops.js";
import { validateImdfForGoogleHandler } from "../validators/google_profile.js";
import { acquireFootprint } from "./footprint_ops.js";
import { extractFloorPlan } from "./pdf_extract_ops.js";

// Tool router definitions
export function registerTools() {
  return [
    // ── Pipeline Step 1: Footprint ────────────────────────────────
    {
      name: "acquire_footprint",
      description: "Fetches the georeferenced building outline for any venue. Uses Google Places API to locate the venue, then queries OSM Overpass for the actual building polygon. Returns a GeoJSON FeatureCollection ready to use as the IMDF venue/footprint geometry.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Venue name and address, e.g. 'Caesars Superdome, New Orleans, LA'" },
          country_code: { type: "string", description: "ISO 3166-1 alpha-2 country code (e.g. 'US', 'FI')" },
          output_path: { type: "string", description: "Optional: save footprint GeoJSON to this file path" }
        },
        required: ["query"]
      }
    },
    // ── Pipeline Step 2: PDF Extraction ──────────────────────────
    {
      name: "extract_floor_plan",
      description: "Extracts indoor floor plan polygons from a PDF file using PyMuPDF+Shapely (Python subprocess), then georeferences them using the venue footprint polygon. Writes all 16 IMDF GeoJSON layers to the output directory.",
      inputSchema: {
        type: "object",
        properties: {
          pdf_path: { type: "string", description: "Absolute path to the PDF floor plan" },
          pages: { type: "array", items: { type: "number" }, description: "0-indexed PDF page numbers to extract, e.g. [1, 2, 3]" },
          venue_footprint_geojson: { type: "object", description: "GeoJSON FeatureCollection from acquire_footprint" },
          output_dataset_path: { type: "string", description: "Directory path where IMDF GeoJSON files will be written" },
          level_names: { type: "array", items: { type: "string" }, description: "Optional display names per level" },
          venue_name: { type: "string", description: "Venue display name" }
        },
        required: ["pdf_path", "pages", "venue_footprint_geojson", "output_dataset_path"]
      }
    },
    // ── Pipeline Steps 3/4: Layer I/O ────────────────────────────
    {
      name: "list_indoor_datasets",
      description: "Lists local folders that contain IMDF datasets (detected by presence of venue.geojson).",
      inputSchema: { type: "object", properties: { base_dir: { type: "string" } } }
    },
    {
      name: "read_geojson_layer",
      description: "Reads a specific IMDF GeoJSON layer from a dataset directory (e.g. 'venue', 'unit', 'level').",
      inputSchema: {
        type: "object",
        properties: {
          dataset_path: { type: "string" },
          layer_name: { type: "string", description: "Layer name without .geojson extension" }
        },
        required: ["dataset_path", "layer_name"]
      }
    },
    {
      name: "write_geojson_layer",
      description: "Overwrites a specific IMDF GeoJSON layer in a dataset directory.",
      inputSchema: {
        type: "object",
        properties: {
          dataset_path: { type: "string" },
          layer_name: { type: "string" },
          geojson_data: { type: "object", description: "GeoJSON FeatureCollection to write" }
        },
        required: ["dataset_path", "layer_name", "geojson_data"]
      }
    },
    // ── Pipeline Step 5: Validation ───────────────────────────────
    {
      name: "validate_imdf_for_google",
      description: "Validates an IMDF dataset for Google Maps Content Partners compliance. Checks: all 16 layers present, required metadata (name/category), unit→level cross-references, and optional geometric alignment against a reference footprint.",
      inputSchema: {
        type: "object",
        properties: {
          dataset_path: { type: "string" },
          archive_path: { type: "string" },
          profile: { type: "string", enum: ["google_maps", "imdf_core"] },
          fail_on: { type: "string", enum: ["error", "warning", "none"] },
          alignment_options: { type: "object" }
        },
        required: ["dataset_path"]
      }
    },
    // ── Pipeline Step 6: Packaging ─────────────────────────────────
    {
      name: "package_imdf_zip",
      description: "Packages all GeoJSON files and manifest.json from a dataset directory into a ZIP archive ready for Google Maps Content Partners upload.",
      inputSchema: {
        type: "object",
        properties: {
          dataset_path: { type: "string" },
          output_zip_path: { type: "string" }
        },
        required: ["dataset_path", "output_zip_path"]
      }
    }
  ];
}

export async function handleToolCall(request: CallToolRequest) {
  const { name, arguments: args } = request.params;
  try {
    if (name === "acquire_footprint") {
      const parsed = AcquireFootprintSchema.parse(args);
      const res = await acquireFootprint(parsed);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
    if (name === "extract_floor_plan") {
      const parsed = ExtractFloorPlanSchema.parse(args);
      const res = await extractFloorPlan(parsed);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
    if (name === "list_indoor_datasets") {
      const parsed = ListDatasetsSchema.parse(args || {});
      const res = await listIndoorDatasets(parsed);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
    if (name === "read_geojson_layer") {
      const parsed = ReadLayerSchema.parse(args);
      const res = await readGeojsonLayer(parsed);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
    if (name === "write_geojson_layer") {
      const parsed = WriteLayerSchema.parse(args);
      const res = await writeGeojsonLayer(parsed);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
    if (name === "package_imdf_zip") {
      const parsed = PackageZipSchema.parse(args);
      const res = await packageImdfZip(parsed);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
    if (name === "validate_imdf_for_google") {
      const parsed = ValidateImdfSchema.parse(args);
      const res = await validateImdfForGoogleHandler(parsed);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error executing ${name}: ${error.message}` }], isError: true };
  }
}
