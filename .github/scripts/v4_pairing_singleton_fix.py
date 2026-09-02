from pathlib import Path

# shared singleton registry in pairingChallenge.ts
p=Path('desktop/electron/pairingChallenge.ts')
s=p.read_text()
if 'export function getWorkspacePairingChallengeManager' not in s:
    s += "\nconst sharedManagers = new Map<string, WorkspacePairingChallengeManager>();\n\nexport function getWorkspacePairingChallengeManager(\n  workspaceId: string,\n  desktopDeviceId: string,\n  workspaceRole: WorkspacePairingContext['workspaceRole'] = 'owner',\n): WorkspacePairingChallengeManager {\n  const key = `${workspaceId}:${desktopDeviceId}:${workspaceRole}`;\n  let manager = sharedManagers.get(key);\n  if (!manager) {\n    manager = new WorkspacePairingChallengeManager(workspaceId, desktopDeviceId, workspaceRole);\n    sharedManagers.set(key, manager);\n  }\n  return manager;\n}\n"
p.write_text(s)

# main uses shared instance
p=Path('desktop/electron/main.ts'); s=p.read_text()
s=s.replace("import { WorkspacePairingChallengeManager } from './pairingChallenge.js';", "import { getWorkspacePairingChallengeManager } from './pairingChallenge.js';")
s=s.replace("const workspacePairingChallenges=new WorkspacePairingChallengeManager(LEGACY_WORKSPACE_ID,LEGACY_DESKTOP_DEVICE_ID,'owner');", "const workspacePairingChallenges=getWorkspacePairingChallengeManager(LEGACY_WORKSPACE_ID,LEGACY_DESKTOP_DEVICE_ID,'owner');")
p.write_text(s)

# internet tunnel uses same instance and only falls back to pair-code for legacy v1 uploads
p=Path('desktop/electron/internetTunnel.ts'); s=p.read_text()
s=s.replace("import { WorkspacePairingChallengeManager } from './pairingChallenge.js';", "import { getWorkspacePairingChallengeManager } from './pairingChallenge.js';")
s=s.replace("const pairingChallenges=new WorkspacePairingChallengeManager(WORKSPACE_ID,DESKTOP_DEVICE_ID,'owner');", "const pairingChallenges=getWorkspacePairingChallengeManager(WORKSPACE_ID,DESKTOP_DEVICE_ID,'owner');")
old="""  const pairingChallenge=decodeURIComponent(response.headers.get('x-photosync-pairing-challenge')||'');
  const workspaceId=decodeURIComponent(response.headers.get('x-photosync-workspace-id')||'');
  if (!pairingChallenges.verify({challenge:pairingChallenge,workspaceId})) throw new Error('Rejected upload with expired or invalid workspace pairing challenge');"""
new="""  const pairingChallenge=decodeURIComponent(response.headers.get('x-photosync-pairing-challenge')||'');
  const workspaceId=decodeURIComponent(response.headers.get('x-photosync-workspace-id')||'');
  const modernPairing=Boolean(pairingChallenge&&workspaceId);
  if (modernPairing && !pairingChallenges.verify({challenge:pairingChallenge,workspaceId})) throw new Error('Rejected upload with expired or invalid workspace pairing challenge');"""
if old not in s: raise SystemExit('challenge verify pattern missing')
s=s.replace(old,new,1)
old="""      'x-photosync-pair-code': await localPairCode(),
      'x-photosync-pairing-challenge': pairingChallenge,
      'x-photosync-workspace-id': workspaceId,"""
new="""      ...(modernPairing ? {
        'x-photosync-pairing-challenge': pairingChallenge,
        'x-photosync-workspace-id': workspaceId,
      } : { 'x-photosync-pair-code': await localPairCode() }),"""
if old not in s: raise SystemExit('local auth headers pattern missing')
s=s.replace(old,new,1)
p.write_text(s)

print('fixed shared pairing manager and v1/v2 relay compatibility')
