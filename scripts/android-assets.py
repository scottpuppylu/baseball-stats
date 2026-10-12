# Generates the Android launcher icons, adaptive icon and splash images from assets/logo-512.webp.
# Run from the repository root:  python scripts/android-assets.py   (needs Pillow)
from pathlib import Path
from PIL import Image

RES = Path('android/app/src/main/res')
BG = (7, 10, 18, 255)  # #070a12, the site's page background
logo = Image.open('assets/logo-512.webp').convert('RGBA')
density = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

def centered(size, scale, background):
    canvas = Image.new('RGBA', size, background)
    side = int(min(size) * scale)
    canvas.alpha_composite(logo.resize((side, side), Image.LANCZOS), ((size[0] - side) // 2, (size[1] - side) // 2))
    return canvas

for name, d in density.items():
    folder = RES / f'mipmap-{name}'
    folder.mkdir(parents=True, exist_ok=True)
    legacy = round(48 * d)
    centered((legacy, legacy), 0.92, BG).save(folder / 'ic_launcher.png')
    # Round icon: the logo is already a circle; keep its transparent corners.
    logo.resize((legacy, legacy), Image.LANCZOS).save(folder / 'ic_launcher_round.png')
    # Adaptive foreground: 108dp canvas, logo inside the 66dp safe circle.
    fg = round(108 * d)
    centered((fg, fg), 0.60, (0, 0, 0, 0)).save(folder / 'ic_launcher_foreground.png')

for path in RES.glob('drawable*/splash.png'):
    w, h = Image.open(path).size
    centered((w, h), 0.42 if w < h else 0.5, BG).convert('RGB').save(path)

(RES / 'values' / 'ic_launcher_background.xml').write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#070A12</color>\n</resources>\n', encoding='utf-8')
print('android icons and splash written')
