import sys
from PIL import Image
comp, out, fr = sys.argv[1], sys.argv[2], sys.argv[3:]
ims = [Image.open(f'review/{comp}-{f}.png') for f in fr]
w, h = ims[0].size
tw = 960 if w > h else 540
th = int(h * tw / w)
cols = 2 if w > h else 3
rows = (len(ims) + cols - 1) // cols
W = Image.new('RGB', (tw * cols, th * rows), 'white')
for i, im in enumerate(ims):
    W.paste(im.resize((tw, th)), ((i % cols) * tw, (i // cols) * th))
W.save(f'review/{out}.png')
