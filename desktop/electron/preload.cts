import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('photoSyncDesktop', {
  platform: process.platform,
  version: process.versions.electron,
  getStatus: () => ipcRenderer.invoke('photosync:status'),
  getTunnelStatus: () => ipcRenderer.invoke('photosync:tunnel-status'),
  listLocalMedia: () => ipcRenderer.invoke('photosync:list-local'),
  listCloudUploads: () => ipcRenderer.invoke('photosync:list-cloud-uploads'),
  getBackupHealth: () => ipcRenderer.invoke('photosync:backup-health'),
  openLibrary: () => ipcRenderer.invoke('photosync:open-library'),
  openExternal: (url: string) => ipcRenderer.invoke('photosync:open-external', url),
  addGoogleAccount: () => ipcRenderer.invoke('photosync:add-google'),
  listGoogleAccounts: () => ipcRenderer.invoke('photosync:list-google-accounts'),
  removeGoogleAccount: (accountId: string) => ipcRenderer.invoke('photosync:remove-google-account', accountId),
  retryCloud: () => ipcRenderer.invoke('photosync:retry-cloud'),
  createWebLoginLink: () => ipcRenderer.invoke('photosync:web-login-link'),
  listWorkspaceDevices: () => ipcRenderer.invoke('photosync:workspace-devices'),
  listWorkspaceSessions: () => ipcRenderer.invoke('photosync:workspace-sessions'),
  revokeWorkspaceSession: (sessionId: string) => ipcRenderer.invoke('photosync:workspace-session-revoke', sessionId),
  revokeWorkspaceDevice: (deviceId: string) => ipcRenderer.invoke('photosync:workspace-device-revoke', deviceId),
  listGooglePhotosAccounts: () => ipcRenderer.invoke('photosync:google-photos-accounts'),
  connectGooglePhotosAccount: (capability: 'picker'|'append') => ipcRenderer.invoke('photosync:google-photos-connect', capability),
  removeGooglePhotosAccount: (accountId: string) => ipcRenderer.invoke('photosync:google-photos-remove', accountId),
  listMigrations: () => ipcRenderer.invoke('photosync:migration-list'),
  getMigration: (jobId: string) => ipcRenderer.invoke('photosync:migration-snapshot', jobId),
  createMigration: (input: unknown) => ipcRenderer.invoke('photosync:migration-create', input),
  materializeMigration: (jobId: string) => ipcRenderer.invoke('photosync:migration-materialize', jobId),
  runMigration: (jobId: string) => ipcRenderer.invoke('photosync:migration-run', jobId),
  pauseMigration: (jobId: string) => ipcRenderer.invoke('photosync:migration-pause', jobId),
  resumeMigration: (jobId: string) => ipcRenderer.invoke('photosync:migration-resume', jobId),
  cancelMigration: (jobId: string) => ipcRenderer.invoke('photosync:migration-cancel', jobId),
  retryMigration: (jobId: string) => ipcRenderer.invoke('photosync:migration-retry', jobId),
  onFileReceived: (callback: (event: { name: string; path: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { name: string; path: string }) => callback(payload);
    ipcRenderer.on('photosync:file-received', handler);
    return () => ipcRenderer.removeListener('photosync:file-received', handler);
  },
  onStorageUpdated: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('photosync:storage-updated', handler);
    return () => ipcRenderer.removeListener('photosync:storage-updated', handler);
  },
  onMigrationUpdated: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('photosync:migration-updated', handler);
    return () => ipcRenderer.removeListener('photosync:migration-updated', handler);
  },
  onTunnelState: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('photosync:tunnel-state', handler);
    return () => ipcRenderer.removeListener('photosync:tunnel-state', handler);
  },
});
