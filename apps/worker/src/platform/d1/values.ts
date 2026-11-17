import { D1Value } from "./types";

function finiteNumber(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError("D1 numeric value must be finite");
  return value;
}

/** Convert integer-like values to a JavaScript Number, never BigInt. */
export function d1Int(value: number | bigint): number {
  const number = finiteNumber(Number(value));
  if (!Number.isInteger(number)) throw new TypeError("D1 integer value must be integral");
  return number;
}

/** Convert numeric values to a D1-safe JavaScript Number. */
export function d1Number(value: number | bigint): number {
  return finiteNumber(Number(value));
}

/** Map missing optional numbers to SQL NULL, never undefined. */
export function d1NullableNumber(value: number | bigint | null | undefined): number | null {
  return value === null || value === undefined ? null : d1Number(value);
}

export function d1NullableInt(value: number | bigint | null | undefined): number | null {
  return value === null || value === undefined ? null : d1Int(value);
}

/** Map missing optional strings to SQL NULL, never undefined. */
export function d1NullableString(value: string | null | undefined): string | null {
  return value === null || value === undefined ? null : value;
}

export function d1Bool(value: boolean): number {
  return value ? 1 : 0;
}

/** Normalize a bind list and reject unsupported values before D1 sees them. */
export function d1Values(values: readonly unknown[]): D1Value[];
export function d1Values(...values: unknown[]): D1Value[];
export function d1Values(...values: unknown[]): D1Value[] {
  const source = values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
  return source.map((value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value;
    if (typeof value === "number") return finiteNumber(value);
    if (typeof value === "bigint") return d1Number(value);
    throw new TypeError("D1 bind value must be string, number, or null");
  });
}

export const d1BindValues = d1Values;
export const toD1Number = d1Number;
export const toD1Int = d1Int;
export const toD1NullableNumber = d1NullableNumber;
export const toD1NullableInt = d1NullableInt;
export const toD1NullableString = d1NullableString;
