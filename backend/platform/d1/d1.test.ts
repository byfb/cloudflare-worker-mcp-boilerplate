import { describe, expect, it, vi } from "vitest";
import {
  D1Error,
  D1Executor,
  getDb,
  getDbOrApiError,
  stableErrorMessage,
  wrapD1Error,
} from ".";
import { d1Int, d1NullableNumber, d1Values } from ".";
import type { D1Database, D1PreparedStatement } from ".";

describe("D1 platform", () => {
  it("normalizes optional values to Number/null", () => {
    expect(d1Int(4n)).toBe(4);
    expect(d1NullableNumber(undefined)).toBeNull();
    expect(d1NullableNumber(2n)).toBe(2);
    expect(d1Values([1n, undefined, null, "name"])).toEqual([1, null, null, "name"]);
  });

  it("resolves a DB binding and wraps primitive failures stably", () => {
    const db = { prepare: () => ({}) } as unknown as D1Database;
    expect(getDb({ DB: db })).toBe(db);
    expect(() => getDb({})).toThrow("D1 unavailable failed: D1 binding DB is missing");
    expect(stableErrorMessage(undefined)).toBe("undefined");
    expect(stableErrorMessage(7)).toBe("7");
    expect(wrapD1Error("query", "boom")).toBeInstanceOf(D1Error);
  });

  it("maps a missing binding to the public unavailable error", () => {
    expect(() => getDbOrApiError({})).toThrowError(
      expect.objectContaining({
        status: 500,
        code: "d1_unavailable",
        message: "D1 binding DB is missing",
      }),
    );
  });
});

describe("D1Executor", () => {
  function fixture() {
    const statement = {
      bind: vi.fn(),
      first: vi.fn(),
      all: vi.fn(),
      raw: vi.fn(),
      run: vi.fn(),
    } as unknown as D1PreparedStatement;
    vi.mocked(statement.bind).mockReturnValue(statement);
    const database = {
      prepare: vi.fn(() => statement),
      batch: vi.fn(),
      exec: vi.fn(),
    } as unknown as D1Database;
    return { database, statement };
  }

  it("normalizes values and exposes bound statements", () => {
    const { database, statement } = fixture();
    const executor = new D1Executor(database);

    expect(executor.statement("SELECT ?1, ?2", [3n, undefined])).toBe(statement);
    expect(database.prepare).toHaveBeenCalledWith("SELECT ?1, ?2");
    expect(statement.bind).toHaveBeenCalledWith(3, null);
  });

  it("returns first rows, all rows, and run results", async () => {
    const { database, statement } = fixture();
    vi.mocked(statement.first).mockResolvedValue({ id: "first" });
    vi.mocked(statement.all).mockResolvedValue({
      success: true,
      results: [{ id: "one" }, { id: "two" }],
    });
    vi.mocked(statement.run).mockResolvedValue({ success: true, meta: { changes: 1 } });
    const executor = new D1Executor(database);

    await expect(executor.first<{ id: string }>("SELECT first")).resolves.toEqual({ id: "first" });
    await expect(executor.all<{ id: string }>("SELECT all")).resolves.toEqual([
      { id: "one" },
      { id: "two" },
    ]);
    await expect(executor.run("UPDATE row")).resolves.toEqual({
      success: true,
      meta: { changes: 1 },
    });
  });

  it.each([
    ["bind", "d1_bind_failed"],
    ["query", "d1_query_failed"],
    ["run", "d1_run_failed"],
  ] as const)("maps %s failures to their public stage code", async (stage, code) => {
    const { database, statement } = fixture();
    const executor = new D1Executor(database);

    if (stage === "bind") {
      vi.mocked(statement.bind).mockImplementation(() => {
        throw new Error("bind boom");
      });
      expect(() => executor.statement("SELECT 1")).toThrowError(
        expect.objectContaining({ code, message: "bind boom" }),
      );
      return;
    }

    if (stage === "query") {
      vi.mocked(statement.first).mockRejectedValue(new Error("query boom"));
      await expect(executor.first("SELECT 1")).rejects.toEqual(
        expect.objectContaining({ code, message: "query boom" }),
      );
      return;
    }

    vi.mocked(statement.run).mockRejectedValue(new Error("run boom"));
    await expect(executor.run("UPDATE row")).rejects.toEqual(
      expect.objectContaining({ code, message: "run boom" }),
    );
  });

  it("uses an injected failure mapper without losing stage or cause", async () => {
    const { database, statement } = fixture();
    const cause = new Error("query boom");
    vi.mocked(statement.all).mockRejectedValue(cause);
    const executor = new D1Executor(
      database,
      (stage, error) => Object.assign(new Error(`custom ${stage}`), { stage, cause: error }),
    );

    await expect(executor.all("SELECT 1")).rejects.toEqual(
      expect.objectContaining({ message: "custom query", stage: "query", cause }),
    );
  });
});
