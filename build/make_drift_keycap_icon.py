import os
from PIL import Image, ImageDraw

def draw_drift_icon(tile_color=(31, 78, 91, 255)): # Deep ocean teal #1F4E5B
    SIZE = 2048
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    COLOR_TILE = tile_color
    COLOR_CREAM_TOP = (242, 233, 214, 255)    # Warm cream face top #F2E9D6
    COLOR_CREAM_BOT = (228, 215, 188, 255)    # Warm cream face bottom #E4D7BC
    COLOR_CREAM_SKIRT = (216, 201, 168, 255)  # Slightly darker cream skirt #D8C9A8
    COLOR_SEPIA_DARK = (42, 36, 28, 255)     # Dark sepia ink #2A241C
    COLOR_WOOD_DARK = (130, 70, 35, 255)      # Warm driftwood brown
    COLOR_WOOD_LIGHT = (195, 130, 85, 255)    # Warm driftwood highlight
    COLOR_WAVE_TEAL = (70, 140, 150, 255)     # Pixel wave accent

    # 1. Base rounded tile
    tile_radius = int(SIZE * 0.22)
    draw.rounded_rectangle([0, 0, SIZE, SIZE], radius=tile_radius, fill=COLOR_TILE)

    # 2. Raised Keycap Card Box
    cap_size = int(SIZE * 0.64)
    cap_margin = (SIZE - cap_size) // 2
    cap_left = cap_margin
    cap_top = cap_margin - 15  # slightly centered
    cap_right = cap_margin + cap_size
    cap_bottom = cap_margin + cap_size - 15
    cap_box = [cap_left, cap_top, cap_right, cap_bottom]
    cap_radius = 250
    outline_width = int(SIZE * 0.025)

    # 3D Skirt
    skirt_offset = int(SIZE * 0.032)
    skirt_box = [cap_left, cap_top + skirt_offset, cap_right, cap_bottom + skirt_offset]
    draw.rounded_rectangle(skirt_box, radius=cap_radius, fill=COLOR_CREAM_SKIRT, outline=COLOR_SEPIA_DARK, width=outline_width)

    # Gradient cap face
    cap_mask = Image.new("L", (SIZE, SIZE), 0)
    cap_mask_draw = ImageDraw.Draw(cap_mask)
    cap_mask_draw.rounded_rectangle(cap_box, radius=cap_radius, fill=255)

    gradient_img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    grad_draw = ImageDraw.Draw(gradient_img)
    height = cap_bottom - cap_top
    for y in range(cap_top, cap_bottom):
        t = (y - cap_top) / max(1, (height - 1))
        r = int(COLOR_CREAM_TOP[0] * (1 - t) + COLOR_CREAM_BOT[0] * t)
        g = int(COLOR_CREAM_TOP[1] * (1 - t) + COLOR_CREAM_BOT[1] * t)
        b = int(COLOR_CREAM_TOP[2] * (1 - t) + COLOR_CREAM_BOT[2] * t)
        grad_draw.line([(cap_left, y), (cap_right, y)], fill=(r, g, b, 255))

    img.paste(gradient_img, (0, 0), cap_mask)
    draw.rounded_rectangle(cap_box, radius=cap_radius, outline=COLOR_SEPIA_DARK, width=outline_width)

    # 3. Center Pixel Art Driftwood Emblem
    # Grid of pixel art block size inside keycap
    center_x = SIZE // 2
    center_y = cap_top + height // 2

    # Draw pixelated driftwood log & waves using scaled grid blocks
    P = 36 # pixel size unit

    def p_rect(gx, gy, gw, gh, color):
        x1 = center_x + gx * P
        y1 = center_y + gy * P
        x2 = x1 + gw * P
        y2 = y1 + gh * P
        draw.rectangle([x1, y1, x2, y2], fill=color)

    def p_outline_rect(gx, gy, gw, gh, fill_color, outline_color=COLOR_SEPIA_DARK):
        x1 = center_x + gx * P
        y1 = center_y + gy * P
        x2 = x1 + gw * P
        y2 = y1 + gh * P
        draw.rectangle([x1, y1, x2, y2], fill=fill_color, outline=outline_color, width=int(P*0.4))

    # Pixel Driftwood Log shape (isometric angle / log body)
    # Log body
    p_rect(-9, -3, 16, 5, COLOR_SEPIA_DARK)
    p_rect(-8, -2, 14, 3, COLOR_WOOD_DARK)
    p_rect(-6, -2, 10, 1, COLOR_WOOD_LIGHT) # top highlight
    # Log branch / stump detail
    p_rect(2, -5, 4, 3, COLOR_SEPIA_DARK)
    p_rect(3, -4, 2, 2, COLOR_WOOD_DARK)

    # Log end ring (left end)
    p_rect(-9, -2, 2, 3, COLOR_WOOD_LIGHT)
    p_rect(-9, -1, 1, 1, COLOR_WOOD_DARK)

    # Pixel Water Waves below log
    # Wave 1 (Upper)
    p_rect(-11, 3, 6, 1, COLOR_SEPIA_DARK)
    p_rect(-5, 4, 10, 1, COLOR_SEPIA_DARK)
    p_rect(5, 3, 6, 1, COLOR_SEPIA_DARK)

    # Wave 2 (Lower)
    p_rect(-8, 6, 8, 1, COLOR_WAVE_TEAL)
    p_rect(0, 7, 7, 1, COLOR_WAVE_TEAL)

    img_1024 = img.resize((1024, 1024), resample=Image.LANCZOS)
    return img_1024

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    print("Generating Meetingly-styled Drift icon...")
    img = draw_drift_icon()
    
    png_path = os.path.join(base_dir, "icon.png")
    img.save(png_path, format="PNG")

    ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
    ico_path = os.path.join(base_dir, "icon.ico")
    ico_images = [img.resize(sz, resample=Image.LANCZOS) for sz in ico_sizes]
    ico_images[0].save(ico_path, format="ICO", sizes=ico_sizes, append_images=ico_images[1:])

    print("Updated icon.png and icon.ico successfully!")

if __name__ == "__main__":
    main()
