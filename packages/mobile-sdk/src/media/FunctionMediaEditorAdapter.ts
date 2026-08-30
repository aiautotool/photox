import type { MediaAsset } from '@photox/contracts';
import type { MediaEditorAdapter } from './MediaActions';

export type MediaEditorLaunch = (input: {
  asset: MediaAsset;
  sourceUri: string;
  outputFilename?: string;
}) => Promise<{ uri: string; mimeType?: string; width?: number; height?: number } | null>;

export class FunctionMediaEditorAdapter implements MediaEditorAdapter {
  constructor(private readonly launch: MediaEditorLaunch) {}

  edit(input: {
    asset: MediaAsset;
    sourceUri: string;
    outputFilename?: string;
  }): Promise<{ uri: string; mimeType?: string; width?: number; height?: number } | null> {
    return this.launch(input);
  }
}
