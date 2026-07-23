import os
from PIL import Image, ImageDraw

SIZE = 2048
BUILD_DIR = os.path.dirname(os.path.abspath(__file__))

# Color Palette (Meetingly aesthetic + Warm Cedar Sunset Polaroid)
COLOR_CEDAR = (150, 75, 45, 255)       # Rich Warm Cedar Tile #964B2D
COLOR_CREAM = (242, 233, 214, 255)     # Warm Cream Card #F2E9D6
COLOR_SEPIA = (42, 36, 28, 255)       # Dark Sepia Ink Outline #2A241C
COLOR_SUNSET_RED = (215, 85, 65, 255)  # Sunset Red
COLOR_SUN = (240, 165, 55, 255)        # Golden Sun
COLOR_TEAL_WAVE = (45, 110, 125, 255)  # Ocean Wave

def draw_drift_winner_icon():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Base Tile
    tile_radius = int(SIZE * 0.22)
    draw.rounded_rectangle([0, 0, SIZE, SIZE], radius=tile_radius, fill=COLOR_CEDAR)

    # 2. Pixel Unit & Geometry
    cx, cy = SIZE // 2, SIZE // 2 - 20
    P = 44

    def p(gx, gy, gw, gh, fill):
        draw.rectangle([cx + gx * P, cy + gy * P, cx + (gx + gw) * P, cy + (gy + gh) * P], fill=fill)

    # Polaroid Frame Outline
    p(-11, -12, 22, 23, COLOR_SEPIA)
    # Polaroid Body Fill
    p(-10, -11, 20, 21, COLOR_CREAM)
    # Photo Window Outline
    p(-8, -9, 16, 13, COLOR_SEPIA)

    # Photo Window Sunset Gradient Rows
    p(-7, -8, 14, 3, COLOR_SUNSET_RED)
    p(-7, -5, 14, 4, COLOR_SUN)
    p(-7, -1, 14, 4, COLOR_TEAL_WAVE)

    # Sun Disc
    p(-2, -7, 4, 4, COLOR_CREAM)

    # Ocean Wave Line below Polaroid Frame
    p(-11, 12, 22, 2, COLOR_SEPIA)
    p(-10, 12, 20, 1, COLOR_CREAM)

    return img.resize((1024, 1024), resample=Image.LANCZOS)

def main():
    print("Generating official Drift app icon (Variation 4: Warm Cedar Sunset Polaroid)...")
    img_1024 = draw_drift_winner_icon()

    # Save icon.png (512x512)
    png_path = os.path.join(BUILD_DIR, "icon.png")
    img_512 = img_1024.resize((512, 512), resample=Image.LANCZOS)
    img_512.save(png_path, format="PNG")
    print(f"Saved {png_path}")

    # Save icon.ico (16px to 256px)
    ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
    ico_path = os.path.join(BUILD_DIR, "icon.ico")
    ico_images = [img_1024.resize(sz, resample=Image.LANCZOS) for sz in ico_sizes]
    ico_images[0].save(ico_path, format="ICO", sizes=ico_sizes, append_images=ico_images[1:])
    print(f"Saved {ico_path}")

if __name__ == "__main__":
    main()
