import urllib.request
import math
import struct
import os
from io import BytesIO
try:
    from PIL import Image
except ImportError:
    import subprocess
    import sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image

def deg2num(lat_deg, lon_deg, zoom):
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return (xtile, ytile)

def num2deg(xtile, ytile, zoom):
    n = 2.0 ** zoom
    lon_deg = xtile / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * ytile / n)))
    lat_deg = math.degrees(lat_rad)
    return (lat_deg, lon_deg)

def download_tile(z, x, y):
    url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as response:
        return Image.open(BytesIO(response.read())).convert('RGB')

def generate_dem():
    bbox = [78.4, 30.3, 78.55, 30.45]
    grid_size = 256
    zoom = 12

    x_min, y_max = deg2num(bbox[1], bbox[0], zoom)
    x_max, y_min = deg2num(bbox[3], bbox[2], zoom)
    
    tiles_w = x_max - x_min + 1
    tiles_h = y_max - y_min + 1
    
    stitched = Image.new('RGB', (tiles_w * 256, tiles_h * 256))
    for tx in range(x_min, x_max + 1):
        for ty in range(y_min, y_max + 1):
            print(f"Fetching {zoom}/{tx}/{ty}")
            img = download_tile(zoom, tx, ty)
            stitched.paste(img, ((tx - x_min) * 256, (ty - y_min) * 256))
    
    top_left_lat, top_left_lon = num2deg(x_min, y_min, zoom)
    bot_right_lat, bot_right_lon = num2deg(x_max + 1, y_max + 1, zoom)
    
    def lat2y(lat):
        return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
        
    y_top = lat2y(top_left_lat)
    y_bot = lat2y(bot_right_lat)
    
    grid = []
    for gy in range(grid_size):
        lat = bbox[3] - (gy / (grid_size - 1)) * (bbox[3] - bbox[1])
        y = lat2y(lat)
        py = (y_top - y) / (y_top - y_bot) * (tiles_h * 256)
        
        for gx in range(grid_size):
            lon = bbox[0] + (gx / (grid_size - 1)) * (bbox[2] - bbox[0])
            px = (lon - top_left_lon) / (bot_right_lon - top_left_lon) * (tiles_w * 256)
            
            px = max(0, min(tiles_w * 256 - 1, int(px)))
            py = max(0, min(tiles_h * 256 - 1, int(py)))
            
            r, g, b = stitched.getpixel((px, py))
            elev = (r * 256 + g + b / 256.0) - 32768
            grid.append(elev)
            
    os.makedirs('public/data/tehri', exist_ok=True)
    with open('public/data/tehri/elevation.bin', 'wb') as f:
        f.write(struct.pack(f'<{len(grid)}f', *grid))
        
    print(f"Generated elevation.bin for Tehri! Min: {min(grid)} Max: {max(grid)}")

if __name__ == '__main__':
    generate_dem()
