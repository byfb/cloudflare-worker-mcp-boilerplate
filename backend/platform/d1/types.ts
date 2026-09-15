/** Values accepted by D1's bind API. Undefined and BigInt never cross this boundary. */
export type D1Value = string | number | null;

export interface D1Meta {
  [key: string]: unknown;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta?: D1Meta;
}

export interface D1ExecResult {
  success: boolean;
  meta?: D1Meta;
}

export interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
  run(): Promise<D1ExecResult>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1ExecResult[]>;
  exec(query: string): Promise<D1ExecResult>;
}

export type D1Env = Record<string, unknown> & {
  DB?: D1Database;
};
