import { router } from 'expo-router';
import IMGLYEditor, { EditorPreset, SourceType, type EditorSettings, type EditorResult, type Source } from '@imgly/editor-react-native';

const originalOpenEditor = IMGLYEditor.openEditor.bind(IMGLYEditor);
let installed = false;

/**
 * Photo editing policy:
 * - Native IMG.LY photo editor is the default because it provides a complete,
 *   production editor with real crop/transform/adjust/filter/text/draw/export.
 * - The custom PhotoX editor remains available only when a caller explicitly
 *   sets metadata.__photoxUseCustomEditor === true.
 *
 * This avoids routing normal Edit taps into an experimental/custom screen that
 * may not implement every editing operation yet.
 */
export function installPhotoEditorNavigationBridge() {
  if (installed) return;
  installed = true;

  const EditorClass = IMGLYEditor as unknown as { openEditor: typeof IMGLYEditor.openEditor };
  EditorClass.openEditor = async (settings, source, preset, metadata) => {
    if (
      preset === EditorPreset.PHOTO &&
      source?.type === SourceType.IMAGE &&
      metadata?.__photoxUseCustomEditor === true
    ) {
      const id = String(metadata?.sourceAssetId || `asset_${Date.now()}`);
      router.push({
        pathname: '/editor',
        params: {
          id,
          uri: source.source,
          filename: String(metadata?.filename || id),
          width: metadata?.width != null ? String(metadata.width) : undefined,
          height: metadata?.height != null ? String(metadata.height) : undefined,
          mimeType: metadata?.mimeType != null ? String(metadata.mimeType) : undefined,
        },
      });
      return null;
    }

    return originalOpenEditor(settings, source, preset, metadata);
  };
}

export function openNativePhotoEditor(
  settings: EditorSettings,
  source: Source,
  metadata: Record<string, unknown> = {},
): Promise<EditorResult | null> {
  return originalOpenEditor(settings, source, EditorPreset.PHOTO, metadata);
}
