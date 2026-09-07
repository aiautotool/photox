import { File as ExpoFile, FileMode } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { ResumableUploadClient, type ResumableUploadSession, type ResumableUploadSessionStore, type ResumableUploadSource } from '@photox/mobile-sdk';
import type { PairedDesktop } from './pairing';
import { accessHeaders, ensureWorkspaceAccess } from './pairing';

const SESSION_PREFIX = 'photosync.resumable.v1';
const HASH_CHUNK_BYTES = 1024 * 1024;

function safeKeyPart(value: string | undefined) {
  return (value || 'none').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160);
}

function assertNotAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error('RESUMABLE_UPLOAD_ABORTED');
  error.name = 'AbortError';
  throw error;
}

class ExpoSecureSessionStore implements ResumableUploadSessionStore {
  constructor(private readonly target: PairedDesktop) {}

  private key(assetId: string) {
    return [SESSION_PREFIX, safeKeyPart(this.target.workspaceId), safeKeyPart(this.target.desktopId), safeKeyPart(this.target.deviceId), safeKeyPart(assetId)].join('.');
  }

  async load(assetId: string): Promise<ResumableUploadSession | null> {
    const raw = await SecureStore.getItemAsync(this.key(assetId));
    if (!raw) return null;
    try { return JSON.parse(raw) as ResumableUploadSession; }
    catch {
      await this.remove(assetId);
      return null;
    }
  }

  async save(assetId: string, session: ResumableUploadSession): Promise<void> {
    await SecureStore.setItemAsync(this.key(assetId), JSON.stringify(session), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }

  async remove(assetId: string): Promise<void> {
    await SecureStore.deleteItemAsync(this.key(assetId));
  }
}

function rotr(value: number, bits: number) { return (value >>> bits) | (value << (32 - bits)); }

class Sha256 {
  private readonly state = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  private readonly buffer = new Uint8Array(64);
  private buffered = 0;
  private bytes = 0;
  private static readonly K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ]);

  update(data: Uint8Array) {
    this.bytes += data.byteLength;
    let offset = 0;
    while (offset < data.byteLength) {
      const take = Math.min(64 - this.buffered, data.byteLength - offset);
      this.buffer.set(data.subarray(offset, offset + take), this.buffered);
      this.buffered += take;
      offset += take;
      if (this.buffered === 64) {
        this.compress(this.buffer);
        this.buffered = 0;
      }
    }
  }

  private compress(block: Uint8Array) {
    const w = new Uint32Array(64);
    for (let i=0;i<16;i++) {
      const j=i*4;
      w[i]=((block[j]<<24)|(block[j+1]<<16)|(block[j+2]<<8)|block[j+3])>>>0;
    }
    for (let i=16;i<64;i++) {
      const s0=(rotr(w[i-15],7)^rotr(w[i-15],18)^(w[i-15]>>>3))>>>0;
      const s1=(rotr(w[i-2],17)^rotr(w[i-2],19)^(w[i-2]>>>10))>>>0;
      w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;
    }
    let [a,b,c,d,e,f,g,h]=Array.from(this.state);
    for (let i=0;i<64;i++) {
      const S1=(rotr(e,6)^rotr(e,11)^rotr(e,25))>>>0;
      const ch=((e&f)^((~e)&g))>>>0;
      const t1=(h+S1+ch+Sha256.K[i]+w[i])>>>0;
      const S0=(rotr(a,2)^rotr(a,13)^rotr(a,22))>>>0;
      const maj=((a&b)^(a&c)^(b&c))>>>0;
      const t2=(S0+maj)>>>0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    this.state[0]=(this.state[0]+a)>>>0; this.state[1]=(this.state[1]+b)>>>0;
    this.state[2]=(this.state[2]+c)>>>0; this.state[3]=(this.state[3]+d)>>>0;
    this.state[4]=(this.state[4]+e)>>>0; this.state[5]=(this.state[5]+f)>>>0;
    this.state[6]=(this.state[6]+g)>>>0; this.state[7]=(this.state[7]+h)>>>0;
  }

  digestHex() {
    const bitLength = this.bytes * 8;
    this.buffer[this.buffered++] = 0x80;
    if (this.buffered > 56) {
      this.buffer.fill(0, this.buffered);
      this.compress(this.buffer);
      this.buffered = 0;
    }
    this.buffer.fill(0, this.buffered, 56);
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    this.buffer[56]=(high>>>24)&255; this.buffer[57]=(high>>>16)&255; this.buffer[58]=(high>>>8)&255; this.buffer[59]=high&255;
    this.buffer[60]=(low>>>24)&255; this.buffer[61]=(low>>>16)&255; this.buffer[62]=(low>>>8)&255; this.buffer[63]=low&255;
    this.compress(this.buffer);
    return Array.from(this.state).map(value => value.toString(16).padStart(8,'0')).join('');
  }
}

export function createExpoUploadSource(uri: string, size: number): ResumableUploadSource {
  const file = new ExpoFile(uri);
  return {
    size,
    async readChunk(offset: number, length: number, signal?: AbortSignal) {
      assertNotAborted(signal);
      const handle = file.open(FileMode.ReadOnly);
      try {
        handle.offset = offset;
        const chunk = handle.readBytes(length);
        assertNotAborted(signal);
        return chunk;
      } finally { handle.close(); }
    },
    async sha256(signal?: AbortSignal) {
      assertNotAborted(signal);
      const hash = new Sha256();
      const handle = file.open(FileMode.ReadOnly);
      try {
        let remaining = size;
        while (remaining > 0) {
          assertNotAborted(signal);
          const chunk = handle.readBytes(Math.min(HASH_CHUNK_BYTES, remaining));
          if (!chunk.byteLength) throw new Error('UPLOAD_SOURCE_HASH_READ_FAILED');
          hash.update(chunk);
          remaining -= chunk.byteLength;
        }
      } finally { handle.close(); }
      assertNotAborted(signal);
      return hash.digestHex();
    },
  };
}

export function createMobileResumableClient(
  target: PairedDesktop,
  baseUrl: string,
  extraHeaders: Record<string,string> = {},
) {
  return new ResumableUploadClient({
    baseUrl,
    sessionStore: new ExpoSecureSessionStore(target),
    getHeaders: async () => {
      await ensureWorkspaceAccess(target);
      return { ...accessHeaders(target), ...extraHeaders };
    },
    onUnauthorized: async () => {
      target.accessExpiresAt = 0;
      await ensureWorkspaceAccess(target);
    },
  });
}
