import { Injectable } from '@nestjs/common';
import { createDecipheriv } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

// Duplicated from apps/api/src/modules/room-booking/encryption.service.ts — same per-app
// duplication convention as PrismaService (each app owns its own copy rather than sharing a
// package). The worker only ever decrypts (it never creates a RoomCalendarConnection), so
// encrypt() isn't reproduced here.
@Injectable()
export class RoomBookingEncryptionService {
  private getKey(): Buffer {
    const raw = process.env.ROOM_BOOKING_ENCRYPTION_KEY;
    if (!raw) throw new Error('ROOM_BOOKING_ENCRYPTION_KEY is not configured on this deployment');
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('ROOM_BOOKING_ENCRYPTION_KEY must decode to exactly 32 bytes');
    return key;
  }

  // Layout: iv (12 bytes) || authTag (16 bytes) || ciphertext — must match encrypt() exactly.
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
