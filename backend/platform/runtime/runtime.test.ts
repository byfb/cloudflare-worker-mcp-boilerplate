import { describe, expect, it } from "vitest";
import { FixedClock } from "./clock";
import { newToken, newUlid, SystemIdGenerator } from "./ids";

describe("runtime seams", () => {
  it("generates canonical ULIDs from injectable clock/randomness", () => {
    const allZero = (bytes: Uint8Array): void => {
      bytes.fill(0);
    };
    const id = newUlid(new FixedClock(0), allZero);
    expect(id).toBe("00000000000000000000000000");
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const one = newUlid(new FixedClock(1), allZero);
    expect(one).toHaveLength(26);
    expect(one).not.toBe(id);
  });

  it("consumes 16 random bytes and keeps only the low 80 bits", () => {
    let requested = 0;
    const sequence = (bytes: Uint8Array): void => {
      requested = bytes.length;
      bytes.set(Uint8Array.from({ length: 16 }, (_, index) => index + 1));
    };
    expect(newUlid(new FixedClock(1_700_000_000_000), sequence)).toBe(
      "01HF7YAT000W40J2GB1G6GW3RG",
    );
    expect(requested).toBe(16);
  });

  it("generates deterministic lowercase 16-byte hex tokens", () => {
    const sequence = (bytes: Uint8Array): void => {
      bytes.forEach((_, index) => {
        bytes[index] = index;
      });
    };
    expect(newToken(sequence)).toBe("000102030405060708090a0b0c0d0e0f");
  });

  it("injects both seams through IdGenerator", () => {
    const generator = new SystemIdGenerator(new FixedClock(42), (bytes) => {
      bytes.fill(0xff);
    });
    expect(generator.ulid()).toHaveLength(26);
    expect(generator.token()).toBe("ffffffffffffffffffffffffffffffff");
  });
});
