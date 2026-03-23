import { z } from "zod";

// --- VALIDATE IMDF TOOL SCHEMA ---
export const ValidateImdfSchema = z.object({
  dataset_path: z.string().describe("Ruta a la carpeta que contiene los archivos GeoJSON IMDF (obligatorio si archive_path falta)"),
  archive_path: z.string().optional().describe("Ruta a un archivo .zip IMDF (opcional)"),
  profile: z.enum(["google_maps", "imdf_core"]).default("google_maps"),
  fail_on: z.enum(["error", "warning", "none"]).default("error"),
  alignment_options: z.object({
    reference_footprint_path: z.string().optional().describe("Ruta al GeoJSON del footprint externo/oficial de referencia"),
    max_center_offset_meters: z.number().default(20).describe("Distancia máxima en metros permitida entre centroides"),
    max_area_ratio_diff: z.number().default(0.3).describe("Diferencia máxima porcentual en el área plana (ej: 0.3 = 30%)")
  }).optional()
});
export type ValidateImdfArgs = z.infer<typeof ValidateImdfSchema>;

// --- LIST DATASETS TOOL SCHEMA ---
export const ListDatasetsSchema = z.object({
  base_dir: z.string().optional().describe("Directorio base para buscar datasets, por defecto la ruta del servidor")
});
export type ListDatasetsArgs = z.infer<typeof ListDatasetsSchema>;

// --- READ/WRITE LAYER SCHEMA ---
export const ReadLayerSchema = z.object({
  dataset_path: z.string().describe("Ruta del dataset IMDF"),
  layer_name: z.string().describe("Nombre de la capa a leer (ej: venue, level, unit)")
});
export type ReadLayerArgs = z.infer<typeof ReadLayerSchema>;

export const WriteLayerSchema = z.object({
  dataset_path: z.string().describe("Ruta del dataset IMDF"),
  layer_name: z.string().describe("Nombre de la capa a sobrescribir (ej: venue, level, unit)"),
  geojson_data: z.any().describe("El objeto GeoJSON FeatureCollection a escribir")
});
export type WriteLayerArgs = z.infer<typeof WriteLayerSchema>;

// --- PACKAGING SCHEMAS ---
export const PackageZipSchema = z.object({
  dataset_path: z.string().describe("Ruta del dataset IMDF (carpeta con archivos GeoJSON)"),
  output_zip_path: z.string().describe("Ruta de destino absoluta o relativa para el archivo .zip generado")
});
export type PackageZipArgs = z.infer<typeof PackageZipSchema>;

// --- ACQUIRE FOOTPRINT TOOL SCHEMA ---
export const AcquireFootprintSchema = z.object({
  query: z.string().describe("Venue name and address, e.g. 'Caesars Superdome, New Orleans, LA'"),
  country_code: z.string().optional().describe("ISO 3166-1 alpha-2 country code to bias results (e.g. 'US', 'FI')"),
  output_path: z.string().optional().describe("If provided, saves the footprint GeoJSON to this path")
});
export type AcquireFootprintArgs = z.infer<typeof AcquireFootprintSchema>;

// --- EXTRACT FLOOR PLAN TOOL SCHEMA ---
export const ExtractFloorPlanSchema = z.object({
  pdf_path: z.string().describe("Absolute path to the PDF floor plan file"),
  pages: z.array(z.number().int().min(0)).describe("0-indexed PDF page numbers to extract (e.g. [1, 2, 3])"),
  venue_footprint_geojson: z.any().describe("GeoJSON FeatureCollection of the venue polygon (from acquire_footprint)"),
  output_dataset_path: z.string().describe("Path to directory where IMDF GeoJSON files will be written"),
  level_names: z.array(z.string()).optional().describe("Optional display names for each level, in order (e.g. ['Ground Floor', 'Level 1'])"),
  venue_name: z.string().optional().describe("Venue name for IMDF metadata")
});
export type ExtractFloorPlanArgs = z.infer<typeof ExtractFloorPlanSchema>;

// --- OUTPUT ENUMS ---
export enum IssueSeverity {
  ERROR = "error",
  WARNING = "warning",
  INFO = "info"
}

export enum IssueCode {
  MISSING_LAYER = "MISSING_LAYER",
  INVALID_GEOMETRY = "INVALID_GEOMETRY",
  MISSING_NAME = "MISSING_NAME",
  MISSING_CATEGORY = "MISSING_CATEGORY",
  INVALID_LEVEL_REFERENCE = "INVALID_LEVEL_REFERENCE",
  GOOGLE_REQUIRED_METADATA_MISSING = "GOOGLE_REQUIRED_METADATA_MISSING",
  FOOTPRINT_MISALIGNED = "FOOTPRINT_MISALIGNED",
  FLOOR_AREA_TOO_SMALL = "FLOOR_AREA_TOO_SMALL",
  FLOOR_AREA_TOO_LARGE = "FLOOR_AREA_TOO_LARGE",
  POI_OUTSIDE_FOOTPRINT = "POI_OUTSIDE_FOOTPRINT",
  CENTER_OFFSET_TOO_LARGE = "CENTER_OFFSET_TOO_LARGE",
  MISSING_FOOTPRINT = "MISSING_FOOTPRINT",
  INVALID_LEVEL_ID_REFERENCE = "INVALID_LEVEL_ID_REFERENCE",
  EMPTY_REQUIRED_LAYER = "EMPTY_REQUIRED_LAYER"
}

export interface ValidationIssue {
  severity: IssueSeverity;
  code: IssueCode | string;
  layer: string;
  feature_id?: string;
  message: string;
  details?: Record<string, any>;
}

export interface SuggestedFix {
  code: string;
  message: string;
}

export interface ValidationOutput {
  status: "pass" | "fail";
  summary: {
    errors: number;
    warnings: number;
    score: number;
  };
  issues: ValidationIssue[];
  suggested_fixes: SuggestedFix[];
  artifacts?: {
    report_path?: string;
  };
}
