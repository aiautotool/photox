# @photox/image-editor

Reusable, non-destructive Photo Editor SDK shared by mobile and desktop. UI is intentionally separate.

## Architecture

- `PhotoEditorSDK` facade
- `PresetEngine`: grouped presets + intensity, represented as normal operations
- `AdjustmentEngine`: Light, Color, Detail, Effects, HSL and Tone Curve operations
- `CropEngine`: crop ratios, rotate, flip, straighten, perspective
- `RetouchEngine`: heal, object removal and subtle face adjustments via plugins
- `SmartPresetEngine`: injected scene analyzer -> top preset recommendations
- `HistoryEngine`: Original -> operation timeline and jump-to-state
- `ExportEngine`: resolution/format/quality/metadata/color-profile options
- `EditRepository`: persistence contract for originalAssetId, editedAssetId and editRecipe

## UI contract

Mobile can build Lightroom + Google Photos style controls without putting rendering logic in React components. Presets are first-class and non-destructive: applying one expands to ordinary adjustments, so users can continue in Adjust and tune each value.

Expected toolbar: `Presets | Adjust | Crop | Retouch | Filters | Effects | Draw | Text`.

Expected scene labels for Smart Preset: portrait, sky, food, night, indoor, document, landscape.

Renderer/AI implementations are adapters. The recipe remains portable between iOS, Android and desktop.
