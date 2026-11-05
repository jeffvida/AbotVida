import json, base64, io
from PIL import Image, ImageOps, ImageDraw
m = json.load(open('photos/map.json')); d = json.load(open('photos/catalog.json'))
first = {}
for p in d['products']:
    u = [x.strip() for x in str(p.get('imageUrl') or '').split('\n') if x.strip()]
    if u: first[u[0]] = p['name'][:28]
print('PRODUCTS_WITH_PHOTOS', len(first), 'of', len(d['products']))
tiles = []
for u, name in list(first.items())[:12]:
    v = m.get(u, {})
    if 'file' not in v: print('ERR', u[:80], v); continue
    im = Image.open('photos/' + v['file']).convert('RGB'); print('DIM', im.size, v.get('type'), u[:70])
    S = 200
    cover = ImageOps.fit(im, (S, S)); contain = Image.new('RGB', (S, S), 'white'); c = ImageOps.contain(im, (S - 16, S - 16)); contain.paste(c, ((S - c.width)//2, (S - c.height)//2))
    tiles.append((cover, contain, name))
W = Image.new('RGB', (420 * 2, 215 * ((len(tiles)+1)//2)), (238, 242, 247)); dr = ImageDraw.Draw(W)
for i, (a, b, n) in enumerate(tiles):
    x, y = (i % 2) * 420, (i // 2) * 215
    W.paste(a, (x, y)); W.paste(b, (x + 205, y)); dr.text((x + 3, y + 202), n, fill=(0, 0, 0))
buf = io.BytesIO(); W.save(buf, 'JPEG', quality=70); print('SHEET_B64 ' + base64.b64encode(buf.getvalue()).decode())
