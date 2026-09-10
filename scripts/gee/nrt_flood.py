"""Near-real-time Sentinel-1 flood extent for a Cascade scenario, via the Earth Engine Python API.

Runs the same UN-SPIDER change-detection method as the in-app script, but headless, so it can be
scheduled (cron / Task Scheduler) during an event. The result is written as GeoJSON that the
dashboard imports in Observe -> Import observed extent.

Setup (once):
    pip install earthengine-api
    earthengine authenticate
Usage:
    python scripts/gee/nrt_flood.py tehri --project my-gcp-project
    python scripts/gee/nrt_flood.py bhakra --project my-gcp-project \
        --pre 2026-07-01 2026-07-15 --post 2026-08-20 2026-09-01 --threshold 1.2
Output:
    public/data/<scenario>/observed.geojson  (plus a printed flooded-area figure)
"""

import argparse
import datetime as dt
import json
import pathlib
import sys

try:
    import ee
except ImportError:  # pragma: no cover - guidance for first-time users
    sys.exit("earthengine-api is not installed: pip install earthengine-api")

ROOT = pathlib.Path(__file__).resolve().parents[2]


def flood_extent(aoi, before, after, polarization, pass_direction, threshold):
    s1 = (
        ee.ImageCollection("COPERNICUS/S1_GRD")
        .filter(ee.Filter.eq("instrumentMode", "IW"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", polarization))
        .filter(ee.Filter.eq("orbitProperties_pass", pass_direction))
        .filter(ee.Filter.eq("resolution_meters", 10))
        .filterBounds(aoi)
        .select(polarization)
    )
    before_col = s1.filterDate(*before)
    after_col = s1.filterDate(*after)
    n_before, n_after = before_col.size().getInfo(), after_col.size().getInfo()
    if n_before == 0 or n_after == 0:
        raise SystemExit(f"No Sentinel-1 scenes (before {n_before}, after {n_after}); widen the date windows.")
    radius = 50
    before_img = before_col.mosaic().clip(aoi).focal_mean(radius, "circle", "meters")
    after_img = after_col.mosaic().clip(aoi).focal_mean(radius, "circle", "meters")
    flooded = after_img.divide(before_img).gt(threshold).rename("flooded").selfMask()
    permanent = ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("seasonality").gte(10).unmask(0)
    flooded = flooded.updateMask(permanent.Not())
    slope = ee.Algorithms.Terrain(ee.Image("WWF/HydroSHEDS/03VFDEM")).select("slope")
    flooded = flooded.updateMask(slope.lt(5))
    flooded = flooded.updateMask(flooded.connectedPixelCount(8).gte(8))
    return flooded, n_before, n_after


def main():
    today = dt.date.today()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("scenario", help="scenario id, e.g. tehri")
    p.add_argument("--project", required=True, help="Google Cloud project registered for Earth Engine")
    p.add_argument("--pre", nargs=2, default=[str(today - dt.timedelta(days=45)), str(today - dt.timedelta(days=30))])
    p.add_argument("--post", nargs=2, default=[str(today - dt.timedelta(days=12)), str(today)])
    p.add_argument("--polarization", choices=["VH", "VV"], default="VH")
    p.add_argument("--pass", dest="pass_direction", choices=["DESCENDING", "ASCENDING"], default="DESCENDING")
    p.add_argument("--threshold", type=float, default=1.25)
    p.add_argument("--scale", type=int, default=30, help="vectorisation scale in metres")
    args = p.parse_args()

    scenario = json.loads((ROOT / "public" / "scenarios" / f"{args.scenario}.json").read_text())
    ee.Initialize(project=args.project)
    aoi = ee.Geometry.Rectangle(scenario["bbox"])
    flooded, n_before, n_after = flood_extent(aoi, args.pre, args.post, args.polarization, args.pass_direction, args.threshold)

    area = flooded.multiply(ee.Image.pixelArea()).reduceRegion(
        reducer=ee.Reducer.sum(), geometry=aoi, scale=10, bestEffort=True, maxPixels=1e10
    ).get("flooded")
    area_km2 = (ee.Number(area).getInfo() or 0) / 1e6

    vectors = flooded.reduceToVectors(
        geometry=aoi, scale=args.scale, geometryType="polygon", eightConnected=False,
        bestEffort=True, maxPixels=1e10, tileScale=4,
    ).limit(5000)
    collection = vectors.getInfo()
    collection["properties"] = {
        "source": "Sentinel-1 GRD change detection (UN-SPIDER method) via Google Earth Engine",
        "before": args.pre,
        "after": args.post,
        "scenes_before": n_before,
        "scenes_after": n_after,
        "threshold": args.threshold,
        "flooded_km2": round(area_km2, 2),
        "generated": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }
    out = ROOT / "public" / "data" / args.scenario / "observed.geojson"
    out.write_text(json.dumps(collection))
    print(f"{len(collection['features'])} polygons, {area_km2:.2f} km² newly flooded -> {out}")


if __name__ == "__main__":
    main()
