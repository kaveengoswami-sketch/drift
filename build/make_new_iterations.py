import os
from PIL import Image, ImageDraw

SIZE = 2048
OUT_DIR = r"C:\Users\kavee\.gemini\antigravity\brain\a6b6c470-f351-4d9a-9ae2-37165049d557"
BUILD_DIR = r"D:\Drift\build"

# Meetingly-inspired color palette
COLOR_BRICK_RED = (168, 53, 42, 255)     # #A8352A
COLOR_OCEAN_TEAL = (31, 78, 91, 255)     # #1F4E5B
COLOR_CREAM = (242, 233, 214, 255)       # #F2E9D6
COLOR_SEPIA_DARK = (42, 36, 28, 255)     # #2A241C
COLOR_WOOD = (185, 105, 60, 255)         # Warm driftwood brown
COLOR_SUN = (235, 160, 60, 255)          # Sunset orange
COLOR_SKY_BLUE = (120, 180, 200, 255)    # Sky blue

def draw_polaroid_drift_icon():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Tile
    tile_radius = int(SIZE * 0.22)
    draw.rounded_rectangle([0, 0, SIZE, SIZE], radius=tile_radius, fill=COLOR_BRICK_RED)

    # Pixel Unit
    cx, cy = SIZE // 2, SIZE // 2 - 40
    P = 44

    def p(gx, gy, gw, gh, fill, outline=None, w=0):
        x1, y1 = cx + gx * P, cy + gy * P
        x2, y2 = x1 + gw * P, y1 + gh * P
        draw.rectangle([x1, y1, x2, y2], fill=fill, outline=outline, width=w)

    # Polaroid Frame Outline
    p(-11, -12, 22, 22, COLOR_SEPIA_DARK)
    # Polaroid Body
    p(-10, -11, 20, 20, COLOR_CREAM)

    # Photo Window Outline
    p(-8, -9, 16, 13, COLOR_SEPIA_DARK)
    # Photo Window Sky
    p(-7, -8, 14, 11, COLOR_SKY_BLUE)

    # Sun
    p(2, -6, 4, 4, COLOR_SUN)

    # Mountain / Wave inside photo
    p(-7, -1, 6, 4, COLOR_WOOD)
    p(-2, 0, 9, 3, COLOR_OCEAN_TEAL)

    # Polaroid Bottom Lip Accent / Wave below
    p(-13, 11, 26, 2, COLOR_SEPIA_DARK)
    p(-12, 11, 24, 1, COLOR_CREAM)
    p(-8, 14, 16, 2, COLOR_SEPIA_DARK)
    p(-7, 14, 14, 1, COLOR_CREAM)

    return img.resize((1024, 1024), resample=Image.LANCZOS)

def draw_drift_boat_icon():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Tile
    tile_radius = int(SIZE * 0.22)
    draw.rounded_rectangle([0, 0, SIZE, SIZE], radius=tile_radius, fill=COLOR_OCEAN_TEAL)

    cx, cy = SIZE // 2, SIZE // 2
    P = 48

    def p(gx, gy, gw, gh, fill, outline=None):
        x1, y1 = cx + gx * P, cy + gy * P
        x2, y2 = x1 + gw * P, y1 + gh * P
        draw.rectangle([x1, y1, x2, y2], fill=fill, outline=outline)

    # Sail Outline
    p(-1, -12, 2, 15, COLOR_SEPIA_DARK) # Mast
    p(0, -11, 9, 11, COLOR_SEPIA_DARK)  # Sail outline
    p(1, -10, 7, 9, COLOR_CREAM)        # Sail fill

    # Wooden Hull Outline
    p(-11, 2, 22, 6, COLOR_SEPIA_DARK)
    p(-10, 3, 20, 4, COLOR_WOOD)
    p(-8, 3, 16, 2, COLOR_CREAM) # Highlight deck

    # Ocean Wave Outline
    p(-13, 8, 26, 2, COLOR_SEPIA_DARK)
    p(-12, 8, 24, 1, COLOR_CREAM)

    return img.resize((1024, 1024), resample=Image.LANCZOS)

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(BUILD_DIR, exist_ok=True)

    img_polaroid = draw_polaroid_drift_icon()
    path_polaroid = os.path.join(OUT_DIR, "drift_iter5_polaroid.png")
    img_polaroid.save(path_polaroid)
    print("Saved", path_polaroid)

    img_boat = draw_drift_boat_icon()
    path_boat = os.path.join(OUT_DIR, "drift_iter6_boat.png")
    img_boat.save(path_boat)
    print("Saved", path_boat)

    # Update build icons with Polaroid design as primary
    img_polaroid.save(os.path.join(BUILD_DIR, "icon.png"))
    
    ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
    ico_path = os.path.join(BUILD_DIR, "icon.ico")
    ico_images = [img_polaroid.resize(sz, resample=Image.LANCZOS) for sz in ico_sizes]
    ico_images[0].save(ico_path, format="ICO", sizes=ico_sizes, append_images=ico_images[1:])

    print("Updated icon.png & icon.ico in build directory!")

if __name__ == "__main__":
    main()
