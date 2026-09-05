import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

// docs/modules/room_booking_module_plan.md §7.4/§13.4 — OAuth refresh tokens and client
// credentials are encrypted at rest with authenticated encryption (AES-256-GCM) and a deployment
// secret outside the database (ROOM_BOOKING_ENCRYPTION_KEY), never derived from anything stored
// in Postgres. Never logged, returned from an API response, or included in audit metadata.
@Injectable()
export class RoomBookingEncryptionService {
  private getKey(): Buffer {
    const raw = process.env.ROOM_BOOKING_ENCRYPTION_KEY;
    if (!raw) {
      throw new InternalServerErrorException('Room Booking calendar connectors are not configured on this deployment');
    }
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      throw new InternalServerErrorException('ROOM_BOOKING_ENCRYPTION_KEY must decode to exactly 32 bytes');
    }
    return key;
  }

  // Output layout: iv (12 bytes) || authTag (16 bytes) || ciphertext — self-contained so decrypt
  // never needs a second stored field. Returns a plain Uint8Array (not Node's Buffer subtype) —
  // Prisma's generated client types a `Bytes` column as Uint8Array<ArrayBuffer>, and a Buffer's
  // more specific ArrayBufferLike generic doesn't structurally satisfy that without this.
  encrypt(plaintext: string): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.getKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Buffer.concat's return type generic (ArrayBufferLike) is wider than the ArrayBuffer Prisma
    // expects for a Bytes column; the actual runtime backing store is always a plain ArrayBuffer
    // here (Node never gives Buffer.concat a SharedArrayBuffer), so this is a type-level
    // accommodation, not a real runtime risk.
    return new Uint8Array(Buffer.concat([iv, authTag, ciphertext]));
  }

  decrypt(payload: Uint8Array): string {
    const buf = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
    const ciphertext = buf.subarray(IV_LENGTH + 16);
    const decipher = createDecipheriv(ALGORITHM, this.getKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
