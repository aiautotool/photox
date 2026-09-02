from pathlib import Path

path = Path('desktop/electron/main.ts')
text = path.read_text()
old = "result.push({id:account.id,email,client,folderId,storage:{id:account.id,email,appUsedBytes,providerFreeBytes},quota:{limit:Number(quota.limit||0),usage:Number(quota.usage||0),free:providerFreeBytes}});"
new = "result.push({id:account.id,email,client,folderId,storage:{id:account.id,email,appUsedBytes,providerFreeBytes,providerTotalBytes:Number(quota.limit||0)},quota:{limit:Number(quota.limit||0),usage:Number(quota.usage||0),free:providerFreeBytes}});"
if old not in text:
    raise SystemExit('target storage allocation line not found')
text = text.replace(old, new, 1)
path.write_text(text)
