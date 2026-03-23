import fs from "fs/promises";
import path from "path";
import { ListDatasetsArgs, ReadLayerArgs, WriteLayerArgs } from "../types/index.js";

export async function listIndoorDatasets(args: ListDatasetsArgs) {
  const baseDir = args.base_dir || process.cwd();
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const datasets = [];
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(baseDir, entry.name);
        // Check if there's a manifest or a venue file
        try {
          await fs.access(path.join(fullPath, "venue.geojson"));
          datasets.push({ name: entry.name, path: fullPath, status: "valid_imdf_candidate" });
        } catch {
          // Not an imdf but maybe a dataset
        }
      }
    }
    return { directories: datasets };
  } catch (error: any) {
    throw new Error(`Failed to list datasets in ${baseDir}: ${error.message}`);
  }
}

export async function readGeojsonLayer(args: ReadLayerArgs) {
  const filePath = path.join(args.dataset_path, `${args.layer_name}.geojson`);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (error: any) {
    throw new Error(`Failed to read layer ${args.layer_name} at ${filePath}: ${error.message}`);
  }
}

export async function writeGeojsonLayer(args: WriteLayerArgs) {
  const filePath = path.join(args.dataset_path, `${args.layer_name}.geojson`);
  try {
    await fs.writeFile(filePath, JSON.stringify(args.geojson_data, null, 2), "utf-8");
    return { success: true, file: filePath };
  } catch (error: any) {
    throw new Error(`Failed to write layer ${args.layer_name} to ${filePath}: ${error.message}`);
  }
}
