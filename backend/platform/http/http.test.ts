import { describe, expect, it } from "vitest";
import { ApiError } from "./api-error";
import { RuleViolation } from "../../shared-kernel/rule-violation";
import { json, empty, text, withSetCookie } from "./responses";
import { parseJson } from "./request";
import { Router } from "./router";

describe("HTTP platform", () => {
  it("serializes ApiError with exact JSON content type", async () => {
    const error = ApiError.badRequest("invalid_payload", "username required");
    const response = json(error.bodyJson(), error.status);
    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({
      code: "invalid_payload",
      message: "username required",
    });
  });

  it("maps platform-neutral rule violations to the exact HTTP 400 envelope", async () => {
    const router = new Router();
    router.get("/rule", () => {
      throw new RuleViolation("invalid_rule", "rule rejected");
    });

    const response = await router.handle(new Request("https://example.test/rule"), undefined);
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ code: "invalid_rule", message: "rule rejected" });
  });

  it("supports empty responses and appends cookies", async () => {
    const response = withSetCookie(withSetCookie(empty(204), "a=1"), "b=2");
    expect(response.status).toBe(204);
    expect(response.headers.get("Content-Type")).toBeNull();
    expect(response.headers.get("Set-Cookie")).toBe("a=1, b=2");
    await expect(response.text()).resolves.toBe("");
  });

  it("removes inferred text content type", () => {
    const response = text("Not Found", 404);
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBeNull();
  });

  it("matches exact paths and leaves params raw", async () => {
    const router = new Router<{ marker: string }>();
    router.get("/api/items/:id", ({ params, env }) => json({ id: params.id, marker: env.marker }));

    const response = await router.handle(
      new Request("https://example.test/api/items/a%2Fb?secret=hidden"),
      { marker: "ok" },
    );
    await expect(response.json()).resolves.toEqual({ id: "a%2Fb", marker: "ok" });

    expect((await router.handle(new Request("https://example.test/api/items/a/"), { marker: "ok" })).status).toBe(404);
    expect((await router.handle(new Request("https://example.test/api/items/a", { method: "POST" }), { marker: "ok" })).status).toBe(405);
  });

  it("maps typed and unknown handler errors without leaking details", async () => {
    const router = new Router();
    router.get("/typed", () => {
      throw ApiError.notFound("missing", "item missing");
    });
    router.get("/unknown", () => {
      throw new Error("secret SQL details");
    });

    const typed = await router.handle(new Request("https://example.test/typed"), undefined);
    expect(typed.status).toBe(404);
    await expect(typed.json()).resolves.toEqual({ code: "missing", message: "item missing" });

    const unknown = await router.handle(new Request("https://example.test/unknown"), undefined);
    expect(unknown.status).toBe(500);
    expect(unknown.headers.get("Content-Type")).toBe("application/json");
    await expect(unknown.json()).resolves.toEqual({ code: "internal_error", message: "internal error" });
  });

  it("does not add implicit HEAD or OPTIONS routes", async () => {
    const router = new Router();
    router.get("/health", () => json({ ok: true }));
    expect((await router.handle(new Request("https://example.test/health", { method: "HEAD" }), undefined)).status).toBe(405);
    expect((await router.handle(new Request("https://example.test/health", { method: "OPTIONS" }), undefined)).status).toBe(405);
  });

  it.each(["", '{"broken":'])(
    "maps empty and malformed JSON through the stable payload contract (%j)",
    async (body) => {
      const request = new Request("https://example.test", {
        method: "POST",
        body,
      });
      await expect(parseJson(request)).rejects.toMatchObject({
        status: 400,
        code: "invalid_payload",
        message: "failed to get JSON for body value",
      });
    },
  );
});
