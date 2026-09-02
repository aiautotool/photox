from pathlib import Path
p=Path('desktop/electron/main.ts')
s=p.read_text()
old="const requestHeaders=req.headers.range?{range:req.headers.range}:{};"
new="const requestHeaders:Record<string,string>={};if(req.headers.range)requestHeaders.range=req.headers.range;"
if old not in s:
    raise SystemExit('range header block not found')
p.write_text(s.replace(old,new,1))
