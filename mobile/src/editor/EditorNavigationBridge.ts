import { router } from 'expo-router';

let installed = false;

/**
 * Legacy compatibility bridge.
 * PhotoX now uses @dariyd/react-native-image-filters as the default editor.
 * Older callers may still invoke this installer, so keep it as a harmless no-op.
 */
export function installPhotoEditorNavigationBridge() {
  if (installed) return;
  installed = true;
}

/**
 * Opens the PhotoX image-filters editor for legacy callers that still use the old bridge.
 */
export async function openPhotoFiltersEditor(sourceUri: string, metadata: Record<string, unknown> = {}) {
  router.push({
    pathname: '/editor',
    params: {
      id: String(metadata.sourceAssetId || `asset_${Date.now()}`),
      uri: sourceUri,
      filename: String(metadata.filename || 'photo.jpg'),
      width: metadata.width != null ? String(metadata.width) : undefined,
      height: metadata.height != null ? String(metadata.height) : undefined,
      mimeType: metadata.mimeType != null ? String(metadata.mimeType) : undefined,
    },
  });
}
