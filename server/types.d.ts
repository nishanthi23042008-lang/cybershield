declare module 'jpeg-js' {
  export interface RawImageData {
    width: number;
    height: number;
    data: Uint8Array | Buffer;
  }
  export function decode(jpegData: Buffer | Uint8Array, opts?: { useTArray?: boolean; formatAsRGBA?: boolean; maxMemoryUsageInMB?: number }): RawImageData;
  export function encode(imgData: RawImageData, quality?: number): { width: number; height: number; data: Buffer };
}
