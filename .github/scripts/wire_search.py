from pathlib import Path
p=Path('mobile/src/home/MobileHome.tsx')
s=p.read_text()
s=s.replace("import { PhotoTimeline } from './PhotoTimeline';\n","import { PhotoTimeline } from './PhotoTimeline';\nimport { searchMedia } from '../search/mediaSearch';\n")
old="  const filtered=useMemo(()=>{const q=query.trim().toLowerCase();if(!q)return visiblePhotos;return visiblePhotos.filter(x=>x.filename.toLowerCase().includes(q)||x.mediaType.includes(q));},[visiblePhotos,query]);"
new="  const filtered=useMemo(()=>searchMedia(visiblePhotos,query,library.albums),[visiblePhotos,query,library.albums]);"
if old not in s: raise SystemExit('search filter anchor missing')
s=s.replace(old,new,1)
s=s.replace('placeholder="Tên file hoặc loại media"','placeholder="Tên file, ngày, album, codec, kích thước…"',1)
s=s.replace('Tìm theo filename hoặc image/video. Metadata index nâng cao sẽ dùng search engine phía Core.','Tìm theo tên file, ngày/tháng/năm, loại media, MIME, kích thước, thời lượng, codec/container và album.',1)
p.write_text(s)
