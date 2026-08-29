function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function hasIsoBaseMediaSignature(bytes: Uint8Array): boolean {
  // `ftyp` is normally the first box, but a legal `free`/`wide` box may precede it.
  for (let offset = 4; offset + 4 <= Math.min(bytes.byteLength, 128); offset += 4) {
    if (ascii(bytes, offset, 4) === 'ftyp') return true;
  }
  return false;
}

export function normalizedMimeType(value: string): string {
  return value.split(';', 1)[0]!.trim().toLowerCase();
}

/** Checks signatures for media formats the player can decode; unknown binary types remain allowed. */
export function matchesExpectedMime(bytes: Uint8Array, mimeType: string): boolean {
  const mime = normalizedMimeType(mimeType);
  if (mime === 'image/png') return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mime === 'image/jpeg') return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (mime === 'image/gif') return ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a';
  if (mime === 'image/webp') return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
  if (mime === 'image/svg+xml') {
    const prefix = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '').trimStart().slice(0, 256).toLowerCase();
    return prefix.startsWith('<svg') || prefix.startsWith('<?xml') && prefix.includes('<svg');
  }
  if (mime === 'video/mp4' || mime === 'audio/mp4' || mime === 'video/quicktime') {
    return hasIsoBaseMediaSignature(bytes);
  }
  if (mime === 'video/webm' || mime === 'audio/webm') return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
  if (mime === 'audio/mpeg') {
    return ascii(bytes, 0, 3) === 'ID3' || bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0;
  }
  if (mime === 'audio/wav' || mime === 'audio/wave' || mime === 'audio/x-wav') {
    return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE';
  }
  if (mime === 'application/pdf') return ascii(bytes, 0, 5) === '%PDF-';
  // The synchronization manifest should never introduce an unrecognized playable format without
  // adding an explicit signature rule and target-device decoder qualification first.
  if (mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/')) return false;
  return true;
}
