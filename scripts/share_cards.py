"""Build public Kakao link previews from the published schedule fields."""
import json
import sys
from html import escape
from pathlib import Path
from uuid import UUID

root = Path(__file__).resolve().parents[1]
base = 'https://lee36848759-hub.github.io/team-baba-trip-test/'
rows = json.loads(Path(sys.argv[1]).read_text())

directory = root / 'share'
directory.mkdir(exist_ok=True)
keep = set()
for row in rows:
    trip = str(UUID(row['id']))
    target = base + '?trip=' + trip
    title = escape(row['title'] or '팀바바 출조')
    dates = row['starts'] or ''
    if row['ends'] and row['ends'] != dates:
        dates += ' ~ ' + row['ends']
    details = escape(f"{dates} · 정원 {row['capacity']}명")
    page = directory / (trip + '.html')
    keep.add(page)
    page.write_text(f'''<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>{title} · TEAM BABA</title><meta name="robots" content="noindex">
<meta property="og:type" content="website"><meta property="og:site_name" content="TEAM BABA">
<meta property="og:title" content="{title}"><meta property="og:description" content="{details}">
<meta property="og:image" content="{base}icon512.png">
<meta property="og:url" content="{base}share/{trip}.html">
</head><body><a href="{target}">{title} · 출조 상세 보기</a>
<script>location.replace("{target}")</script></body></html>
''')
for old in directory.glob('*.html'):
    if old not in keep:
        old.unlink()
