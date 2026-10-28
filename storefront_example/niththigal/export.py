"""Build a self-contained browser preview and a clean source archive."""
from pathlib import Path
import base64
import re
import zipfile

ROOT = Path(__file__).resolve().parent

def data_uri(path):
    file = ROOT / path.lstrip('/')
    mime = {'.webp': 'image/webp', '.woff2': 'font/woff2'}[file.suffix]
    return 'data:' + mime + ';base64,' + base64.b64encode(file.read_bytes()).decode()

html = (ROOT / 'index.html').read_text()
for name in ['fonts.css', 'styles.css', 'soft.css']:
    css = (ROOT / name).read_text()
    css = re.sub(r'url\((/assets/fonts/[^)]+)\)', lambda m: 'url(' + data_uri(m.group(1)) + ')', css)
    html = html.replace(f'<link rel="stylesheet" href="/{name}">', '<style>' + css + '</style>')
scripts = []
for name in ['app.js', 'motion.js']:
    html = html.replace(f'<script src="/{name}" defer></script>', '')
    scripts.append((ROOT / name).read_text())
html = html.replace('</body>', '<script>' + '\n'.join(scripts) + '</script></body>')
html = re.sub(r'/assets/(?:hero|jhumka|necklace|bangles)\.webp', lambda m: data_uri(m.group(0)), html)
(ROOT / 'Niththigal.html').write_text(html)
with zipfile.ZipFile(ROOT / 'Niththigal-source.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in ['index.html', 'styles.css', 'soft.css', 'app.js', 'motion.js', 'fonts.css', 'README.md', 'package.json', 'package-lock.json', 'check.cjs', 'export.py']:
        archive.write(ROOT / name, 'niththigal/' + name)
    for file in (ROOT / 'assets').rglob('*'):
        if file.is_file() and file.suffix != '.png':
            archive.write(file, 'niththigal/' + str(file.relative_to(ROOT)))
print('Built Niththigal.html and Niththigal-source.zip')
