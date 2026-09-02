import * as FileSystem from 'expo-file-system/legacy';

export type AlbumId = string;

export interface MobileAlbum {
  id: AlbumId;
  name: string;
  mediaIds: string[];
  coverMediaId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TrashEntry {
  mediaId: string;
  trashedAt: number;
}

export interface MobileLibraryState {
  version: 1;
  favorites: string[];
  archived: string[];
  trash: TrashEntry[];
  albums: MobileAlbum[];
}

const EMPTY_STATE: MobileLibraryState = {
  version: 1,
  favorites: [],
  archived: [],
  trash: [],
  albums: [],
};

const root = FileSystem.documentDirectory || FileSystem.cacheDirectory;
const STATE_PATH = root ? `${root}photox-library-state.json` : null;
const TEMP_PATH = root ? `${root}photox-library-state.tmp.json` : null;

let writeQueue: Promise<void> = Promise.resolve();

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeAlbum(album: MobileAlbum): MobileAlbum {
  const now = Date.now();
  return {
    id: String(album.id),
    name: String(album.name || 'Album').trim() || 'Album',
    mediaIds: unique(Array.isArray(album.mediaIds) ? album.mediaIds.map(String) : []),
    coverMediaId: album.coverMediaId ? String(album.coverMediaId) : undefined,
    createdAt: Number.isFinite(album.createdAt) ? album.createdAt : now,
    updatedAt: Number.isFinite(album.updatedAt) ? album.updatedAt : now,
  };
}

function normalizeState(value: unknown): MobileLibraryState {
  if (!value || typeof value !== 'object') return { ...EMPTY_STATE };
  const raw = value as Partial<MobileLibraryState>;
  const trash = Array.isArray(raw.trash)
    ? raw.trash
        .filter((entry): entry is TrashEntry => Boolean(entry && typeof entry.mediaId === 'string'))
        .map(entry => ({ mediaId: String(entry.mediaId), trashedAt: Number(entry.trashedAt) || Date.now() }))
    : [];
  const dedupedTrash = Array.from(new Map(trash.map(entry => [entry.mediaId, entry])).values());
  return {
    version: 1,
    favorites: unique(Array.isArray(raw.favorites) ? raw.favorites.map(String) : []),
    archived: unique(Array.isArray(raw.archived) ? raw.archived.map(String) : []),
    trash: dedupedTrash,
    albums: Array.isArray(raw.albums) ? raw.albums.map(normalizeAlbum) : [],
  };
}

export async function loadLibraryState(): Promise<MobileLibraryState> {
  if (!STATE_PATH) return { ...EMPTY_STATE };
  try {
    const info = await FileSystem.getInfoAsync(STATE_PATH);
    if (!info.exists) return { ...EMPTY_STATE };
    const text = await FileSystem.readAsStringAsync(STATE_PATH);
    return normalizeState(JSON.parse(text));
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function saveLibraryState(state: MobileLibraryState): Promise<void> {
  const normalized = normalizeState(state);
  writeQueue = writeQueue.then(async () => {
    if (!STATE_PATH || !TEMP_PATH) return;
    const payload = JSON.stringify(normalized);
    await FileSystem.writeAsStringAsync(TEMP_PATH, payload, { encoding: FileSystem.EncodingType.UTF8 });
    await FileSystem.deleteAsync(STATE_PATH, { idempotent: true }).catch(() => undefined);
    await FileSystem.moveAsync({ from: TEMP_PATH, to: STATE_PATH });
  });
  return writeQueue;
}

export async function updateLibraryState(
  updater: (current: MobileLibraryState) => MobileLibraryState,
): Promise<MobileLibraryState> {
  const current = await loadLibraryState();
  const next = normalizeState(updater(current));
  await saveLibraryState(next);
  return next;
}

export function isFavorite(state: MobileLibraryState, mediaId: string) {
  return state.favorites.includes(mediaId);
}

export function isArchived(state: MobileLibraryState, mediaId: string) {
  return state.archived.includes(mediaId);
}

export function isTrashed(state: MobileLibraryState, mediaId: string) {
  return state.trash.some(entry => entry.mediaId === mediaId);
}

export function toggleFavorite(state: MobileLibraryState, mediaId: string): MobileLibraryState {
  const exists = state.favorites.includes(mediaId);
  return {
    ...state,
    favorites: exists ? state.favorites.filter(id => id !== mediaId) : unique([...state.favorites, mediaId]),
  };
}

export function setArchived(state: MobileLibraryState, mediaId: string, archived: boolean): MobileLibraryState {
  return {
    ...state,
    archived: archived ? unique([...state.archived, mediaId]) : state.archived.filter(id => id !== mediaId),
  };
}

export function moveToTrash(state: MobileLibraryState, mediaId: string, now = Date.now()): MobileLibraryState {
  return {
    ...state,
    favorites: state.favorites.filter(id => id !== mediaId),
    archived: state.archived.filter(id => id !== mediaId),
    trash: [...state.trash.filter(entry => entry.mediaId !== mediaId), { mediaId, trashedAt: now }],
  };
}

export function restoreFromTrash(state: MobileLibraryState, mediaId: string): MobileLibraryState {
  return { ...state, trash: state.trash.filter(entry => entry.mediaId !== mediaId) };
}

export function forgetMedia(state: MobileLibraryState, mediaId: string): MobileLibraryState {
  return {
    ...state,
    favorites: state.favorites.filter(id => id !== mediaId),
    archived: state.archived.filter(id => id !== mediaId),
    trash: state.trash.filter(entry => entry.mediaId !== mediaId),
    albums: state.albums.map(album => ({
      ...album,
      mediaIds: album.mediaIds.filter(id => id !== mediaId),
      coverMediaId: album.coverMediaId === mediaId ? undefined : album.coverMediaId,
      updatedAt: Date.now(),
    })),
  };
}

function newAlbumId() {
  return `album_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createAlbum(state: MobileLibraryState, name: string, mediaIds: string[] = []): MobileLibraryState {
  const now = Date.now();
  const album: MobileAlbum = {
    id: newAlbumId(),
    name: name.trim() || 'Album',
    mediaIds: unique(mediaIds),
    coverMediaId: mediaIds[0],
    createdAt: now,
    updatedAt: now,
  };
  return { ...state, albums: [album, ...state.albums] };
}

export function renameAlbum(state: MobileLibraryState, albumId: string, name: string): MobileLibraryState {
  const clean = name.trim();
  if (!clean) return state;
  return {
    ...state,
    albums: state.albums.map(album => album.id === albumId ? { ...album, name: clean, updatedAt: Date.now() } : album),
  };
}

export function deleteAlbum(state: MobileLibraryState, albumId: string): MobileLibraryState {
  return { ...state, albums: state.albums.filter(album => album.id !== albumId) };
}

export function addToAlbum(state: MobileLibraryState, albumId: string, mediaIds: string[]): MobileLibraryState {
  return {
    ...state,
    albums: state.albums.map(album => album.id === albumId ? {
      ...album,
      mediaIds: unique([...album.mediaIds, ...mediaIds]),
      coverMediaId: album.coverMediaId || mediaIds[0],
      updatedAt: Date.now(),
    } : album),
  };
}

export function removeFromAlbum(state: MobileLibraryState, albumId: string, mediaIds: string[]): MobileLibraryState {
  const remove = new Set(mediaIds);
  return {
    ...state,
    albums: state.albums.map(album => {
      if (album.id !== albumId) return album;
      const nextIds = album.mediaIds.filter(id => !remove.has(id));
      return {
        ...album,
        mediaIds: nextIds,
        coverMediaId: album.coverMediaId && !remove.has(album.coverMediaId) ? album.coverMediaId : nextIds[0],
        updatedAt: Date.now(),
      };
    }),
  };
}

export function setAlbumCover(state: MobileLibraryState, albumId: string, mediaId: string): MobileLibraryState {
  return {
    ...state,
    albums: state.albums.map(album => album.id === albumId && album.mediaIds.includes(mediaId)
      ? { ...album, coverMediaId: mediaId, updatedAt: Date.now() }
      : album),
  };
}

export function expiredTrashMediaIds(
  state: MobileLibraryState,
  retentionDays = 30,
  now = Date.now(),
): string[] {
  const cutoff = now - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
  return state.trash.filter(entry => entry.trashedAt <= cutoff).map(entry => entry.mediaId);
}
