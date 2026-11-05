import json, urllib.request, os, hashlib
d = json.load(open('catalog.json')); os.makedirs('photos', exist_ok=True); m = {}
for p in d['products']:
    for u in [x.strip() for x in str(p.get('imageUrl') or '').split('\n') if x.strip()][:2]:
        if len(m) >= 40 or u.startswith('data:'): continue
        f = hashlib.md5(u.encode()).hexdigest()[:12]
        try:
            r = urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30)
            open('photos/' + f, 'wb').write(r.read()); m[u] = {'file': f, 'type': r.headers.get('content-type')}
        except Exception as e: m[u] = {'error': str(e)[:80]}
json.dump(m, open('photos/map.json', 'w')); print('PHOTOS', len(m))
