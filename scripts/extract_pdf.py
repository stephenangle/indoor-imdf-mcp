#!/usr/bin/env python3
"""
extract_pdf.py — IMDF Floor Plan Extractor (PyMuPDF + Shapely)

Called as a subprocess by the indoor-imdf-mcp Node.js server.
Reads PDF pages, extracts vector drawings as polygons, outputs JSON.

Usage:
  python3 extract_pdf.py --pdf /path/to/plan.pdf --pages 1,2,3 --output /tmp/out.json

Output format (JSON written to --output or stdout):
{
  "levels": {
    "1": { "polygons": [[[[x,y],...]], ...], "poi_count": 3 },
    "2": { "polygons": [...], "poi_count": 1 }
  },
  "page_bounds": { "width": 2448, "height": 1584 }
}

Polygon coordinates are normalized to [0, 1] range relative to the
usable map area (after stripping PDF layout artifacts).
The Node.js caller applies georeferencing using the venue footprint.
"""
import argparse
import json
import sys
import math

try:
    import fitz  # PyMuPDF
except ImportError:
    print(json.dumps({"error": "PyMuPDF not installed. Run: pip3 install pymupdf"}))
    sys.exit(1)

try:
    from shapely.geometry import LineString, mapping
    from shapely.ops import polygonize, unary_union
except ImportError:
    print(json.dumps({"error": "Shapely not installed. Run: pip3 install shapely"}))
    sys.exit(1)


def extract_page(page, margin_top=120, margin_bottom=1500, margin_right=2000, min_area=50):
    """Extract valid polygons from a single PDF page."""
    drawings = page.get_drawings()
    lines = []

    for d in drawings:
        for item in d["items"]:
            if item[0] == "l":
                lines.append(LineString([item[1], item[2]]))
            elif item[0] == "c":
                # Bezier approximation: just connect endpoints
                lines.append(LineString([item[1], item[4]]))
            elif item[0] == "re":
                r = item[1]
                lines.append(LineString([
                    (r.x0, r.y0), (r.x1, r.y0),
                    (r.x1, r.y1), (r.x0, r.y1), (r.x0, r.y0)
                ]))

    if not lines:
        return []

    merged = unary_union(lines)
    polys = list(polygonize(merged))

    valid = []
    for p in polys:
        if p.area < min_area:
            continue
        minx, miny, maxx, maxy = p.bounds
        # Strip PDF layout artifacts: title blocks, page frames, legends
        if miny < margin_top or maxy > margin_bottom or maxx > margin_right:
            continue
        valid.append(p)

    return valid


def normalize_polygons(polys, global_bounds):
    """Normalize polygon coordinates to [0, 1] relative to global bounding box."""
    minx, miny, maxx, maxy = global_bounds
    width = maxx - minx
    height = maxy - miny
    if width == 0 or height == 0:
        return []

    normalized = []
    for p in polys:
        geom = mapping(p)
        def norm_coord(pt, _minx=minx, _miny=miny, _width=width, _height=height):
            return [(pt[0] - _minx) / _width, (pt[1] - _miny) / _height]

        if geom["type"] == "Polygon":
            rings = []
            for ring in geom["coordinates"]:
                rings.append([norm_coord(c) for c in ring])
            normalized.append(rings)
    return normalized


def main():
    parser = argparse.ArgumentParser(description="Extract floor plan polygons from PDF")
    parser.add_argument("--pdf", required=True, help="Path to PDF file")
    parser.add_argument("--pages", required=True, help="Comma-separated 0-indexed page numbers")
    parser.add_argument("--output", help="Output JSON file path (default: stdout)")
    parser.add_argument("--margin-top", type=float, default=120)
    parser.add_argument("--margin-bottom", type=float, default=1500)
    parser.add_argument("--margin-right", type=float, default=2000)
    parser.add_argument("--min-area", type=float, default=50)
    args = parser.parse_args()

    try:
        pages = [int(p.strip()) for p in args.pages.split(",")]
    except ValueError:
        print(json.dumps({"error": f"Invalid pages format: {args.pages}"}))
        sys.exit(1)

    try:
        doc = fitz.open(args.pdf)
    except Exception as e:
        print(json.dumps({"error": f"Cannot open PDF: {e}"}))
        sys.exit(1)

    # First pass: collect all polys to compute global bounds
    all_polys_by_page = {}
    all_polys_flat = []

    for page_num in pages:
        if page_num >= len(doc):
            print(json.dumps({"error": f"Page {page_num} out of range (doc has {len(doc)} pages)"}))
            sys.exit(1)
        page = doc[page_num]
        polys = extract_page(
            page,
            margin_top=args.margin_top,
            margin_bottom=args.margin_bottom,
            margin_right=args.margin_right,
            min_area=args.min_area
        )
        all_polys_by_page[page_num] = polys
        all_polys_flat.extend(polys)

    if not all_polys_flat:
        result = {"error": "No polygons extracted from specified pages. Try adjusting margin parameters."}
        if args.output:
            with open(args.output, "w") as f:
                json.dump(result, f)
        else:
            print(json.dumps(result))
        sys.exit(1)

    # Compute global bounds across all pages/levels
    global_union = unary_union(all_polys_flat)
    global_bounds = global_union.bounds  # (minx, miny, maxx, maxy)

    # Second pass: normalize
    page_bounds = {}
    levels_output = {}

    for i, page_num in enumerate(pages):
        polys = all_polys_by_page[page_num]
        normalized = normalize_polygons(polys, global_bounds)
        level_key = str(i + 1)  # 1-indexed level keys
        levels_output[level_key] = {
            "page_index": page_num,
            "polygons": normalized,
            "polygon_count": len(normalized)
        }

    first_page = doc[pages[0]]
    result = {
        "levels": levels_output,
        "page_bounds": {
            "width": first_page.rect.width,
            "height": first_page.rect.height
        },
        "global_bounds": {
            "minx": global_bounds[0],
            "miny": global_bounds[1],
            "maxx": global_bounds[2],
            "maxy": global_bounds[3]
        },
        "total_polygons": len(all_polys_flat)
    }

    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2)
        # Also write to stdout for the Node.js caller to confirm
        print(json.dumps({"success": True, "output_path": args.output, "total_polygons": len(all_polys_flat)}))
    else:
        print(json.dumps(result))


if __name__ == "__main__":
    main()
