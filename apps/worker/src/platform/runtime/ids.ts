import { systemClock } from "./clock";
import type { Clock } from "./clock";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const MAX_ULID_TIMESTAMP = (1n << 48n) - 1n;

/** Random byte seam; implementations mutate the supplied bytes in place. */
export type RandomSource = (bytes: Uint8Array) => void | Uint8Array;

export interface IdGenerator {
  ulid(): string;
  token(): string;
}

export function systemRandom(bytes: Uint8Array): Uint8Array {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw new Error("Web Crypto getRandomValues is unavailable");
  }
  return cryptoApi.getRandomValues(bytes);
}

function fillRandom(source: RandomSource, bytes: Uint8Array): void {
  const result = source(bytes);
  if (result && result !== bytes) bytes.set(result.subarray(0, bytes.length));
}

function normalizedTimestamp(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(Math.min(Math.floor(value), Number(MAX_ULID_TIMESTAMP)));
}

/** Encode 48-bit timestamp + 80 random bits as a canonical 26-char ULID. */
export function newUlid(
  clock: Clock = systemClock,
  random: RandomSource = systemRandom,
): string {
  const timestamp = normalizedTimestamp(clock.nowMs());
  // Consume 16 random bytes and retain the low 80 bits. Reading the full draw
  // keeps deterministic streams and entropy accounting stable.
  const randomBytes = new Uint8Array(16);
  fillRandom(random, randomBytes);

  let randomValue = 0n;
  for (const byte of randomBytes) randomValue = (randomValue << 8n) | BigInt(byte);
  randomValue &= (1n << 80n) - 1n;
  let value = (timestamp << 80n) | randomValue;

  const chars = new Array<string>(26);
  for (let index = 25; index >= 0; index -= 1) {
    chars[index] = CROCKFORD[Number(value & 31n)];
    value >>= 5n;
  }
  return chars.join("");
}

/** Generate a 16-byte lowercase hexadecimal token (32 characters). */
export function newToken(random: RandomSource = systemRandom): string {
  const bytes = new Uint8Array(16);
  fillRandom(random, bytes);
  let value = "";
  for (const byte of bytes) value += byte.toString(16).padStart(2, "0");
  return value;
}

export class SystemIdGenerator implements IdGenerator {
  constructor(
    private readonly clock: Clock = systemClock,
    private readonly random: RandomSource = systemRandom,
  ) {}

  ulid(): string {
    return newUlid(this.clock, this.random);
  }

  token(): string {
    return newToken(this.random);
  }

  newUlid(): string {
    return this.ulid();
  }

  newToken(): string {
    return this.token();
  }
}

export function createIdGenerator(
  clock: Clock = systemClock,
  random: RandomSource = systemRandom,
): IdGenerator {
  return new SystemIdGenerator(clock, random);
}

export const systemIdGenerator: SystemIdGenerator = new SystemIdGenerator();
