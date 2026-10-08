import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("mantém caminhos internos com busca", () => {
    expect(safeNext("/entrar?confirmado=1")).toBe("/entrar?confirmado=1");
    expect(safeNext("/sala/abc#x")).toBe("/sala/abc#x");
  });
  it("rejeita destinos externos, inclusive com barra invertida", () => {
    for (const bad of ["//evil.example", "/\\evil.example/path", "/\\/evil.example", "https://evil.example", "evil", "", null, undefined]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});
