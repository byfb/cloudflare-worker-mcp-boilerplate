import { d1ApiError } from "./errors";
import type {
  D1Database,
  D1ExecResult,
  D1PreparedStatement,
} from "./types";
import { d1Values } from "./values";

export type D1ExecutionStage = "bind" | "query" | "run";

export type D1FailureMapper = (
  stage: D1ExecutionStage,
  cause: unknown,
) => Error;

const defaultFailureMapper: D1FailureMapper = (stage, cause) =>
  d1ApiError(`d1_${stage}_failed`, cause);

/** Own the standard D1 statement lifecycle for one database binding. */
export class D1Executor {
  constructor(
    private readonly database: D1Database,
    private readonly mapFailure: D1FailureMapper = defaultFailureMapper,
  ) {}

  statement(sql: string, values: readonly unknown[] = []): D1PreparedStatement {
    try {
      return this.database.prepare(sql).bind(...d1Values(values));
    } catch (error: unknown) {
      throw this.mapFailure("bind", error);
    }
  }

  async first<T>(sql: string, values: readonly unknown[] = []): Promise<T | null> {
    const statement = this.statement(sql, values);
    try {
      return await statement.first<T>();
    } catch (error: unknown) {
      throw this.mapFailure("query", error);
    }
  }

  async all<T>(sql: string, values: readonly unknown[] = []): Promise<T[]> {
    const statement = this.statement(sql, values);
    try {
      return (await statement.all<T>()).results;
    } catch (error: unknown) {
      throw this.mapFailure("query", error);
    }
  }

  async run(sql: string, values: readonly unknown[] = []): Promise<D1ExecResult> {
    const statement = this.statement(sql, values);
    try {
      return await statement.run();
    } catch (error: unknown) {
      throw this.mapFailure("run", error);
    }
  }
}
