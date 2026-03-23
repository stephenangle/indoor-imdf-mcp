import JSZip from "jszip";
import fs from "fs/promises";
import path from "path";
import { PackageZipArgs } from "../types/index.js";

export async function packageImdfZip(args: PackageZipArgs) {
  const zip = new JSZip();
  try {
    const files = await fs.readdir(args.dataset_path);
    let addedCount = 0;
    
    for (const file of files) {
      if (file.endsWith(".geojson") || file === "manifest.json") {
        const content = await fs.readFile(path.join(args.dataset_path, file), "utf-8");
        zip.file(file, content);
        addedCount++;
      }
    }
    
    if (addedCount === 0) {
      throw new Error("No GeoJSON or manifest files found to compress.");
    }
    
    const zipContent = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(args.output_zip_path, zipContent);
    
    return { 
      success: true, 
      message: `Successfully packaged ${addedCount} IMDF files.`,
      zip_path: args.output_zip_path 
    };
  } catch(e: any) {
    throw new Error(`Failed to package IMDF: ${e.message}`);
  }
}
