import os
from PIL import Image, ImageDraw

def draw_flat_drift_icon(bg_color=(168, 53, 42, 255)): # Brick Red #A8352A
    SIZE = 2048
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    COLOR_BG = bg_color
    COLOR_CREAM = (242, 233, 214, 255)    # Warm cream #F2E9D6
    COLOR_SEPIA = (42, 36, 28, 255)       # Dark sepia ink outline #2A241C
    COLOR_WOOD = (185, 105, 60, 255)      # Warm cedar driftwood
    COLOR_HIGHLIGHT = (230, 175, 125, 255) # Driftwood highlight

    # Rounded tile background (completely flat, no keycap, no skirt)
    tile_radius = int(SIZE * 0.22)
    draw.rounded_rectangle([0, 0, SIZE, SIZE], radius=tile_radius, fill=COLOR_BG)

    # Pixel Grid Unit
    center_x = SIZE // 2
    center_y = SIZE // 2
    P = 48  # pixel block size

    def p_rect(gx, gy, gw, gh, fill_color, outline_color=None, outline_w=0):
        x1 = center_x + gx * P
        y1 = center_y + gy * P
        x2 = x1 + gw * P
        y2 = y1 + gh * P
        draw.rectangle([x1, y1, x2, y2], fill=fill_color, outline=outline_color, width=outline_w)

    # Dark Sepia Outline Backing for Driftwood Log
    p_rect(-10, -4, 18, 7, COLOR_SEPIA)
    p_rect(1, -7, 5, 4, COLOR_SEPIA)
    p_rect(-10, -3, 2, 5, COLOR_SEPIA)

    # Driftwood Body
    p_rect(-9, -3, 16, 5, COLOR_WOOD)
    p_rect(-7, -3, 12, 2, COLOR_HIGHLIGHT)
    p_rect(2, -6, 3, 3, COLOR_WOOD)
    p_rect(3, -6, 1, 2, COLOR_HIGHLIGHT)

    # Driftwood Ring (Left End)
    p_rect(-10, -2, 2, 3, COLOR_CREAM)
    p_rect(-9, -1, 1, 1, COLOR_SEPIA)

    # Warm Cream Wave Lines (Meetingly warm palette)
    # Upper Wave
    p_rect(-12, 4, 7, 1, COLOR_SEPIA)
    p_rect(-11, 4, 5, 1, COLOR_CREAM)
    p_rect(-5, 5, 11, 1, COLOR_SEPIA)
    p_rect(-4, 5, 9, 1, COLOR_CREAM)
    p_rect(6, 4, 7, 1, COLOR_SEPIA)
    p_rect(7, 4, 5, 1, COLOR_CREAM)

    # Lower Wave
    p_rect(-9, 8, 9, 1, COLOR_SEPIA)
    p_rect(-8, 8, 7, 1, COLOR_CREAM)
    p_rect(1, 9, 8, 1, COLOR_SEPIA)
    p_rect(2, 9, 6, 1, COLOR_CREAM)

    img_1024 = img.resize((1024, 1024), resample=Image.LANCZOS)
    return img_1024

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    img = draw_flat_drift_icon()
    
    png_path = os.path.join(base_dir, "icon.png")
    img.save(png_path, format="PNG")

    ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
    ico_path = os.path.join(base_dir, "icon.ico")
    ico_images = [img.resize(sz, resample=Image.LANCZOS) for sz in ico_sizes]
    ico_images[0].save(ico_path, format="ICO", sizes=ico_sizes, append_images=ico_images[1:])

    print("Updated icon.png and icon.ico with flat Meetingly palette logo!")

if __name__ == "__main__":
    main()
