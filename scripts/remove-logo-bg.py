"""Remove black background from logo and make it transparent."""
from PIL import Image

LOGO_PATH = "apps/web/public/plethora-logo.png"
# Pixels darker than this threshold become transparent (0-255)
THRESHOLD = 45

img = Image.open(LOGO_PATH).convert("RGBA")
data = img.getdata()

new_data = []
for item in data:
    r, g, b, a = item
    if r <= THRESHOLD and g <= THRESHOLD and b <= THRESHOLD:
        new_data.append((r, g, b, 0))
    else:
        new_data.append(item)

img.putdata(new_data)
img.save(LOGO_PATH, "PNG")
print(f"Saved transparent logo to {LOGO_PATH}")
