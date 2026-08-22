import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import {
  assertSafeDocumentRoot,
  isPathInsideBase,
  sanitizeHostnameForPath,
} from "./hostname";
import { assertKnownAction, assertPluginId } from "./actions";

describe("hostname allowlist", () => {
  it("rejects path traversal hostnames", () => {
    assert.throws(() => sanitizeHostnameForPath(".."));
    assert.throws(() => sanitizeHostnameForPath("example.com;id"));
    assert.throws(() => sanitizeHostnameForPath("localhost"));
  });

  it("accepts normal domains", () => {
    assert.equal(sanitizeHostnameForPath("Example.COM"), "example.com");
  });

  it("keeps resolved paths inside the sites base", () => {
    const base = process.platform === "win32" ? path.resolve("sites") : "/var/www";
    assert.equal(isPathInsideBase(path.join(base, "a.com", "public_html"), base), true);
    assert.equal(isPathInsideBase("/etc/passwd", base), false);
  });

  it("rejects document roots outside the allowlist", () => {
    assert.throws(() => assertSafeDocumentRoot("/etc/passwd"));
    assert.throws(() => assertSafeDocumentRoot("/var/www/../etc/passwd"));
  });
});

describe("execute action allowlist", () => {
  it("rejects unknown actions", () => {
    assert.throws(() => assertKnownAction("rm_rf"));
    assert.throws(() => assertKnownAction(""));
  });

  it("accepts ping", () => {
    assert.equal(assertKnownAction("ping"), "ping");
  });

  it("rejects unsafe plugin ids", () => {
    assert.throws(() => assertPluginId("../x"));
    assert.throws(() => assertPluginId("mysql;id"));
    assert.equal(assertPluginId("mysql"), "mysql");
  });
});
