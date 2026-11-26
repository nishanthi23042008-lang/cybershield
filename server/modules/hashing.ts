import crypto from 'node:crypto';

export interface FileHashes {
  sha256: string;
  md5: string;
}

export function computeBufferHashes(buffer: Buffer): FileHashes {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const md5 = crypto.createHash('md5').update(buffer).digest('hex');
  return { sha256, md5 };
}
