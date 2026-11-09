"""Contact sheet of QA stills with frame/time labels. Usage: python3 sheet.py <dir> <out.jpg> [cols]"""
import sys, os
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 5
files = sorted(f for f in os.listdir(d) if f.startswith('f') and f.endswith('.png'))
ims = [Image.open(os.path.join(d, f)).convert('RGB') for f in files]
w, h = ims[0].size
tw = 300; th = int(h * tw / w)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw, rows * (th + 26)), (20, 20, 24))
dr = ImageDraw.Draw(sheet)
for i, (f, im) in enumerate(zip(files, ims)):
    x = (i % cols) * tw; y = (i // cols) * (th + 26)
    sheet.paste(im.resize((tw, th)), (x, y + 26))
    fr = int(f[1:5]); dr.text((x + 6, y + 6), f"f{fr}  {fr/30:.2f}s", fill=(255, 255, 255))
sheet.save(out, quality=88)
print(out, sheet.size)
