import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  looksLikeLetsEncryptOnDemandBlock,
  letsEncryptOnDemandBlockMessage,
} from "./letsencrypt-policy";

describe("looksLikeLetsEncryptOnDemandBlock", () => {
  it("blocks consecutive identical blocked labels (test.test.example.com)", () => {
    assert.equal(
      looksLikeLetsEncryptOnDemandBlock("test.test.kongunattugounder.com"),
      true
    );
  });

  it("blocks three blocked labels in a row", () => {
    assert.equal(
      looksLikeLetsEncryptOnDemandBlock("test.api.app.example.com"),
      true
    );
  });

  it("allows normal nested subdomains", () => {
    assert.equal(
      looksLikeLetsEncryptOnDemandBlock("api.v1.example.com"),
      false
    );
    assert.equal(
      looksLikeLetsEncryptOnDemandBlock("demo.test.example.com"),
      false
    );
    assert.equal(looksLikeLetsEncryptOnDemandBlock("example.com"), false);
    assert.equal(looksLikeLetsEncryptOnDemandBlock("www.example.com"), false);
  });

  it("message mentions rename guidance", () => {
    const msg = letsEncryptOnDemandBlockMessage("test.test.example.com");
    assert.match(msg, /Let's Encrypt/);
    assert.match(msg, /demo\.test\.example\.com|Rename/);
  });
});
