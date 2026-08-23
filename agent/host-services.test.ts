import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertHostServiceId,
  assertHostServiceOp,
  HOST_SERVICE_CATALOG,
  HOST_SERVICE_INSTALL,
  installHostService,
  listHostServices,
} from "./host-services";

describe("host service allowlist", () => {
  it("rejects unknown service ids", () => {
    assert.throws(() => assertHostServiceId("sshd"));
    assert.throws(() => assertHostServiceId("nginx.service;id"));
    assert.throws(() => assertHostServiceId(""));
  });

  it("accepts catalog ids", () => {
    assert.equal(assertHostServiceId("visitor-ingest"), "visitor-ingest");
    assert.equal(assertHostServiceId("nginx"), "nginx");
  });

  it("rejects unknown ops", () => {
    assert.throws(() => assertHostServiceOp("reload"));
    assert.throws(() => assertHostServiceOp("status"));
  });

  it("accepts start stop restart", () => {
    assert.equal(assertHostServiceOp("start"), "start");
    assert.equal(assertHostServiceOp("stop"), "stop");
    assert.equal(assertHostServiceOp("restart"), "restart");
  });

  it("uses only safe unit names", () => {
    const unitRe = /^[a-zA-Z0-9:_.@+-]+\.(service|timer)$/;
    const ids = new Set<string>();
    for (const svc of HOST_SERVICE_CATALOG) {
      assert.equal(ids.has(svc.id), false);
      ids.add(svc.id);
      assert.ok(svc.units.length > 0);
      for (const unit of svc.units) {
        assert.match(unit, unitRe);
      }
      for (const extra of svc.alsoStart ?? []) {
        assert.match(extra, unitRe);
      }
    }
    assert.equal(HOST_SERVICE_CATALOG.find((s) => s.id === "panel")?.allowStop, false);
  });

  it("lists catalog rows in dry-run without systemd", async () => {
    const { services, dryRun } = await listHostServices({ dryRun: true });
    assert.equal(dryRun, true);
    assert.equal(services.length, HOST_SERVICE_CATALOG.length);
    assert.equal(services.some((s) => s.id === "visitor-ingest"), true);
  });

  it("maps installable services to scripts under scripts/", () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts");
    for (const [id, spec] of Object.entries(HOST_SERVICE_INSTALL)) {
      assert.equal(assertHostServiceId(id), id);
      assert.equal(path.basename(spec.script), spec.script);
      assert.equal(fs.existsSync(path.join(dir, spec.script)), true, spec.script);
    }
    assert.equal("panel" in HOST_SERVICE_INSTALL, false);
    assert.equal("backup-timer" in HOST_SERVICE_INSTALL, true);
  });

  it("rejects install of non-installable services and dry-runs install", async () => {
    await assert.rejects(() => installHostService({ id: "panel", dryRun: true }));
    const row = await installHostService({ id: "ftp", dryRun: true });
    assert.equal(row.id, "ftp");
    assert.equal(row.installable, true);
    const backup = await installHostService({ id: "backup-timer", dryRun: true });
    assert.equal(backup.id, "backup-timer");
    assert.equal(backup.installable, true);
  });

  it("treats a listening agent port as installed in catalog id agent", () => {
    const agent = HOST_SERVICE_CATALOG.find((s) => s.id === "agent");
    assert.ok(agent);
    assert.equal(agent.units[0], "naviyra-agent.service");
  });
});
