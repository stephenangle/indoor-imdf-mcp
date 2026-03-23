# 🏛️ indoor-imdf-mcp

A Model Context Protocol (MCP) server that covers the **full IMDF generation pipeline** for any venue — from a PDF floor plan to a Google Maps Content Partners-ready ZIP archive.

## 🔁 Full Pipeline (6 Steps)

```
acquire_footprint  →  extract_floor_plan  →  [write_geojson_layer]
       ↓                     ↓                        ↓
  venue polygon          122 units              16 IMDF layers
                                                       ↓
                         validate_imdf_for_google  →  package_imdf_zip  →  ✅ ZIP
```

## 🛠️ Tools

| Step | Tool | Description |
|---|---|---|
| 1 | **`acquire_footprint`** | Google Places API + OSM Overpass → venue building polygon (GeoJSON) |
| 2 | **`extract_floor_plan`** | PDF → 16 complete IMDF layers. Runs PyMuPDF+Shapely via Python subprocess, georeferences using footprint |
| 3/4 | `list_indoor_datasets` / `read_geojson_layer` / `write_geojson_layer` | Inspect and patch individual layers |
| 5 | **`validate_imdf_for_google`** | Validates all 16 GMCP-required layers: structure, metadata, unit→level cross-refs, geometric alignment |
| 6 | `package_imdf_zip` | Packages GeoJSON + manifest into a delivery-ready ZIP |

## ⚙️ Requirements

- Node.js ≥ 18
- Python 3 with `pymupdf` and `shapely` (`pip3 install pymupdf shapely`)
- `GOOGLE_MAPS_API_KEY` environment variable set

## 🚀 Installation & Build

```bash
cd indoor-imdf-mcp
npm install
npm run build
```

Run tests:
```bash
npm test
```

## 🔌 MCP Client Configuration

```json
{
  "mcpServers": {
    "indoor-imdf": {
      "command": "node",
      "args": ["/Users/angle/Documents/gmaps_project/indoor-imdf-mcp/build/server.js"],
      "env": {
        "GOOGLE_MAPS_API_KEY": "YOUR_KEY_HERE"
      }
    }
  }
}
```

## 📋 Usage Example — Any Venue

**Step 1: Get the building footprint**
```json
{
  "tool": "acquire_footprint",
  "args": { "query": "Caesars Superdome, New Orleans, LA", "output_path": "/tmp/superdome_footprint.geojson" }
}
```

**Step 2: Extract floors from PDF**
```json
{
  "tool": "extract_floor_plan",
  "args": {
    "pdf_path": "/path/to/floorplan.pdf",
    "pages": [0, 1, 2],
    "venue_footprint_geojson": { "...": "output from step 1" },
    "output_dataset_path": "/output/superdome_imdf",
    "level_names": ["Ground", "Loge Level", "Suite Level"],
    "venue_name": "Caesars Superdome"
  }
}
```

**Step 3: Validate**
```json
{
  "tool": "validate_imdf_for_google",
  "args": {
    "dataset_path": "/output/superdome_imdf",
    "profile": "google_maps",
    "fail_on": "error"
  }
}
```

**Step 4: Package**
```json
{
  "tool": "package_imdf_zip",
  "args": {
    "dataset_path": "/output/superdome_imdf",
    "output_zip_path": "/output/Superdome_IMDF.zip"
  }
}
```

## 📋 Validation Output Example

```json
{
  "status": "pass",
  "summary": { "errors": 0, "warnings": 27, "score": 46 },
  "issues": [
    { "severity": "warning", "code": "POI_OUTSIDE_FOOTPRINT", "layer": "unit.geojson", ... }
  ],
  "suggested_fixes": [
    { "code": "MOVE_POI_INSIDE_FOOTPRINT", "message": "Move unit geometries within venue boundary." }
  ]
}
```

## 📁 IMDF Layer Reference (All 16 Required by GMCP)

| Layer | Geometry | Required |
|---|---|---|
| `venue` | Polygon | ✅ Must have features |
| `building` | null (unlocated) | ✅ Must have features |
| `footprint` | Polygon | ✅ Must have features |
| `level` | Polygon | ✅ Must have features |
| `unit` | Polygon | ✅ Must have features |
| `fixture` | Polygon | ✅ (empty ok) |
| `section` | Polygon | ✅ (empty ok) |
| `geofence` | Polygon | ✅ (empty ok) |
| `kiosk` | Polygon | ✅ (empty ok) |
| `detail` | LineString | ✅ (empty ok) |
| `opening` | LineString | ✅ (empty ok) |
| `amenity` | Point | ✅ (empty ok) |
| `anchor` | Point | ✅ (empty ok) |
| `occupant` | null (unlocated) | ✅ (empty ok) |
| `address` | null (unlocated) | ✅ (empty ok) |
| `relationship` | null/any | ✅ (empty ok) |
