import os
from PIL import Image, ImageDraw

SIZE = 2048
PREVIEW_DIR = r"D:\Drift\preview_icons"
BUILD_DIR = r"D:\Drift\build"

# Colors
COLOR_SEPIA = (42, 36, 28, 255)       # #2A241C
COLOR_CREAM = (242, 233, 214, 255)     # #F2E9D6
COLOR_WOOD = (185, 105, 60, 255)       # Driftwood brown
COLOR_SUN = (240, 165, 55, 255)        # Warm golden sun
COLOR_SUNSET_RED = (215, 85, 65, 255)  # Sunset red
COLOR_SKY_TEAL = (110, 175, 185, 255)  # Soft sky
COLOR_TEAL_WAVE = (45, 110, 125, 255)  # Ocean wave

COLOR_BRICK_RED = (168, 53, 42, 255)   # #A8352A
COLOR_OCEAN_TEAL = (31, 78, 91, 255)   # #1F4E5B
COLOR_MIDNIGHT = (26, 34, 45, 255)     # #1A222D
COLOR_CEDAR = (150, 75, 45, 255)       # #964B2D
COLOR_GOLDEN = (215, 140, 45, 255)     # #D78C2D

def create_base_tile(color):
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    tile_radius = int(SIZE * 0.22)
    draw.rounded_rectangle([0, 0, SIZE, SIZE], radius=tile_radius, fill=color)
    return img, draw

# Var 1: Tilted Classic Brick Red Polaroid
def draw_var1():
    img, draw = create_base_tile(COLOR_BRICK_RED)
    cx, cy = SIZE // 2, SIZE // 2 - 20
    P = 44
    
    def p(gx, gy, gw, gh, fill):
        draw.rectangle([cx + gx * P, cy + gy * P, cx + (gx + gw) * P, cy + (gy + gh) * P], fill=fill)

    # Polaroid Outline
    p(-11, -12, 22, 23, COLOR_SEPIA)
    # Polaroid Body
    p(-10, -11, 20, 21, COLOR_CREAM)
    # Photo Window Outline
    p(-8, -9, 16, 13, COLOR_SEPIA)
    # Photo Window Sky
    p(-7, -8, 14, 11, COLOR_SKY_TEAL)
    # Big Sun
    p(-2, -7, 6, 6, COLOR_SUN)
    # Mountain peak
    p(-7, -2, 6, 5, COLOR_WOOD)
    p(-1, 0, 8, 3, COLOR_TEAL_WAVE)
    # Waves underneath
    p(-13, 11, 26, 2, COLOR_SEPIA)
    p(-12, 11, 24, 1, COLOR_CREAM)
    p(-8, 14, 16, 2, COLOR_SEPIA)
    p(-7, 14, 14, 1, COLOR_CREAM)
    return img.resize((1024, 1024), resample=Image.LANCZOS)

# Var 2: Ocean Teal + Corner Photo Tabs
def draw_var2():
    img, draw = create_base_tile(COLOR_OCEAN_TEAL)
    cx, cy = SIZE // 2, SIZE // 2 - 20
    P = 44

    def p(gx, gy, gw, gh, fill):
        draw.rectangle([cx + gx * P, cy + gy * P, cx + (gx + gw) * P, cy + (gy + gh) * P], fill=fill)

    # Frame
    p(-11, -12, 22, 23, COLOR_SEPIA)
    p(-10, -11, 20, 21, COLOR_CREAM)
    # Corner photo tabs (Sepia)
    p(-10, -11, 3, 3, COLOR_SEPIA)
    p(7, -11, 3, 3, COLOR_SEPIA)
    # Photo Window
    p(-8, -9, 16, 13, COLOR_SEPIA)
    p(-7, -8, 14, 11, COLOR_SUNSET_RED)
    p(-3, -6, 6, 6, COLOR_SUN)
    p(-7, 0, 14, 3, COLOR_TEAL_WAVE)
    # Driftwood log on bottom border of photo
    p(-6, 7, 12, 2, COLOR_SEPIA)
    p(-5, 7, 10, 1, COLOR_WOOD)
    # Ocean wave
    p(-10, 13, 20, 2, COLOR_SEPIA)
    p(-9, 13, 18, 1, COLOR_CREAM)
    return img.resize((1024, 1024), resample=Image.LANCZOS)

# Var 3: Midnight Navy + Stacked Layered Polaroids
def draw_var3():
    img, draw = create_base_tile(COLOR_MIDNIGHT)
    cx, cy = SIZE // 2, SIZE // 2
    P = 42

    def p(gx, gy, gw, gh, fill):
        draw.rectangle([cx + gx * P, cy + gy * P, cx + (gx + gw) * P, cy + (gy + gh) * P], fill=fill)

    # Back Polaroid (Offset right)
    p(-6, -14, 18, 20, COLOR_SEPIA)
    p(-5, -13, 16, 18, COLOR_CREAM)
    p(-4, -11, 14, 10, COLOR_SEPIA)
    p(-3, -10, 12, 8, COLOR_SUNSET_RED)

    # Front Polaroid (Primary)
    p(-12, -10, 20, 22, COLOR_SEPIA)
    p(-11, -9, 18, 20, COLOR_CREAM)
    p(-9, -7, 14, 12, COLOR_SEPIA)
    p(-8, -6, 12, 10, COLOR_SKY_TEAL)
    p(0, -5, 4, 4, COLOR_SUN)
    p(-8, 0, 12, 4, COLOR_WOOD)

    # Wave below
    p(-13, 13, 22, 2, COLOR_SEPIA)
    p(-12, 13, 20, 1, COLOR_CREAM)
    return img.resize((1024, 1024), resample=Image.LANCZOS)

# Var 4: Warm Cedar + Sunset Gradient Polaroid
def draw_var4():
    img, draw = create_base_tile(COLOR_CEDAR)
    cx, cy = SIZE // 2, SIZE // 2 - 20
    P = 44

    def p(gx, gy, gw, gh, fill):
        draw.rectangle([cx + gx * P, cy + gy * P, cx + (gx + gw) * P, cy + (gy + gh) * P], fill=fill)

    p(-11, -12, 22, 23, COLOR_SEPIA)
    p(-10, -11, 20, 21, COLOR_CREAM)
    p(-8, -9, 16, 13, COLOR_SEPIA)
    # Sunset gradient rows
    p(-7, -8, 14, 3, COLOR_SUNSET_RED)
    p(-7, -5, 14, 4, COLOR_SUN)
    p(-7, -1, 14, 4, COLOR_TEAL_WAVE)
    # Sun circle
    p(-2, -7, 4, 4, COLOR_CREAM)

    # Floating wave
    p(-11, 12, 22, 2, COLOR_SEPIA)
    p(-10, 12, 20, 1, COLOR_CREAM)
    return img.resize((1024, 1024), resample=Image.LANCZOS)

# Var 5: Golden Amber + Driftwood Pin Clip
def draw_var5():
    img, draw = create_base_tile(COLOR_GOLDEN)
    cx, cy = SIZE // 2, SIZE // 2 - 10
    P = 44

    def p(gx, gy, gw, gh, fill):
        draw.rectangle([cx + gx * P, cy + gy * P, cx + (gx + gw) * P, cy + (gy + gh) * P], fill=fill)

    # Frame
    p(-11, -11, 22, 23, COLOR_SEPIA)
    p(-10, -10, 20, 21, COLOR_CREAM)
    
    # Driftwood Clip at Top Left
    p(-9, -14, 5, 5, COLOR_SEPIA)
    p(-8, -13, 3, 3, COLOR_WOOD)

    # Photo Window
    p(-8, -8, 16, 13, COLOR_SEPIA)
    p(-7, -7, 14, 11, COLOR_SKY_TEAL)
    p(-2, -5, 5, 5, COLOR_SUN)
    p(-7, 0, 8, 4, COLOR_TEAL_WAVE)
    p(0, 1, 7, 3, COLOR_WOOD)

    # Wave line below
    p(-12, 13, 24, 2, COLOR_SEPIA)
    p(-11, 13, 22, 1, COLOR_CREAM)
    return img.resize((1024, 1024), resample=Image.LANCZOS)

def main():
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    os.makedirs(BUILD_DIR, exist_ok=True)

    v1 = draw_var1()
    v1.save(os.path.join(PREVIEW_DIR, "polaroid_var1_brick_red.png"))

    v2 = draw_var2()
    v2.save(os.path.join(PREVIEW_DIR, "polaroid_var2_ocean_teal.png"))

    v3 = draw_var3()
    v3.save(os.path.join(PREVIEW_DIR, "polaroid_var3_stacked_navy.png"))

    v4 = draw_var4()
    v4.save(os.path.join(PREVIEW_DIR, "polaroid_var4_warm_cedar.png"))

    v5 = draw_var5()
    v5.save(os.path.join(PREVIEW_DIR, "polaroid_var5_golden_amber.png"))

    # Also copy all 5 to artifacts directory so they can be embedded/viewed
    ART_DIR = r"C:\Users\kavee\.gemini\antigravity\brain\a6b6c470-f351-4d9a-9ae2-37165049d557"
    v1.save(os.path.join(ART_DIR, "polaroid_var1_brick_red.png"))
    v2.save(os.path.join(ART_DIR, "polaroid_var2_ocean_teal.png"))
    v3.save(os.path.join(ART_DIR, "polaroid_var3_stacked_navy.png"))
    v4.save(os.path.join(ART_DIR, "polaroid_var4_warm_cedar.png"))
    v5.save(os.path.join(ART_DIR, "polaroid_var5_golden_amber.png"))

    # Update app build assets with Var 1
    v1.save(os.path.join(BUILD_DIR, "icon.png"))
    ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
    ico_path = os.path.join(BUILD_DIR, "icon.ico")
    ico_images = [v1.resize(sz, resample=Image.LANCZOS) for sz in ico_sizes]
    ico_images[0].save(ico_path, format="ICO", sizes=ico_sizes, append_images=ico_images[1:])

    print("Generated 5 Polaroid variations successfully!")

if __name__ == "__main__":
    main()
