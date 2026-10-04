import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectWindowsService, resolveWindowsService, windowsControlScript, type WindowsService } from "./windows-services";
import { HOST_SERVICE_CATALOG, readWindowsStatus } from "./host-services";

const service = (Name: string, State = "Stopped", StartMode = "Auto"): WindowsService => ({ Name, State, StartMode, ProcessId: 0 });

describe("Windows hosting services", () => {
  it("reports real status in simulation while disabling controls", () => {
    const def = HOST_SERVICE_CATALOG.find((s) => s.id === "apache")!;
    const status = readWindowsStatus(def, true, [service("Apache2.4", "Running")]);
    assert.equal(status.installed, true);
    assert.equal(status.active, true);
    assert.equal(status.enabled, true);
    assert.equal(status.controllable, false);
    assert.equal(readWindowsStatus(def, false, [service("Apache2.4")]).controllable, true);
  });
  it("does not claim missing or Linux-only services are installed", () => {
    for (const id of ["apache", "postfix", "backup-timer"]) {
      const status = readWindowsStatus(HOST_SERVICE_CATALOG.find((s) => s.id === id)!, false, []);
      assert.equal(status.installed, false);
      assert.equal(status.installable, false);
      assert.equal(status.controllable, false);
      assert.equal(status.supported, id === "apache");
    }
  });
  it("blocks panel and agent lifecycle changes that can break their own response", () => {
    const status = readWindowsStatus(HOST_SERVICE_CATALOG.find((s) => s.id === "panel")!, false, [service("NaviyraPanel", "Running")]);
    assert.equal(status.controllable, false);
    assert.equal(status.allowStop, false);
  });
  it("discovers common XAMPP and PostgreSQL service names without matching unrelated services", () => {
    const rows = [service("Apache2.4"), service("mysql"), service("postgresql-x64-17"), service("Spooler")];
    assert.equal(selectWindowsService("apache", rows)?.Name, "Apache2.4");
    assert.equal(selectWindowsService("mysql", rows)?.Name, "mysql");
    assert.equal(selectWindowsService("postgresql", rows)?.Name, "postgresql-x64-17");
    assert.equal(selectWindowsService("Spooler", rows), undefined);
    assert.equal(selectWindowsService("dns", rows), undefined);
    assert.equal(selectWindowsService("nginx", rows), undefined);
  });
  it("refuses ambiguous instances instead of controlling the wrong database", () => {
    assert.throws(() => selectWindowsService("postgresql", [service("postgresql-x64-16"), service("postgresql-x64-17")]), /Multiple Windows services/);
  });
  it("allows an exact service configured by the host administrator", () => {
    const previous = process.env.WINDOWS_SERVICE_MYSQL;
    try {
      process.env.WINDOWS_SERVICE_MYSQL = "CompanyDatabase";
      assert.equal(resolveWindowsService("mysql", [service("CompanyDatabase"), service("mysql")])?.Name, "CompanyDatabase");
      process.env.WINDOWS_SERVICE_MYSQL = "mysql'; Stop-Service Spooler; '";
      assert.throws(() => resolveWindowsService("mysql", []), /Invalid Windows service name/);
    } finally {
      if (previous === undefined) delete process.env.WINDOWS_SERVICE_MYSQL;
      else process.env.WINDOWS_SERVICE_MYSQL = previous;
    }
  });
  it("validates control inputs and refuses disabled and self-hosting services", () => {
    assert.throws(() => windowsControlScript(service("mysql';whoami"), "start"), /Invalid Windows service name/);
    assert.throws(() => windowsControlScript(service("mysql", "Stopped", "Disabled"), "restart"), /disabled/);
    assert.throws(() => windowsControlScript({ ...service("NaviyraAgent"), ProcessId: process.pid }, "stop"), /launcher/);
  });
  it("waits for stop before restart, without forcing dependent services", () => {
    const script = windowsControlScript(service("MySQL84", "Running"), "restart");
    assert.ok(script.indexOf("Stop-Service") < script.indexOf("Start-Service"));
    assert.match(script, /WaitForStatus\('Stopped'/);
    assert.match(script, /WaitForStatus\('Running'/);
    assert.doesNotMatch(script, /-Force|Set-Service/);
    assert.doesNotMatch(windowsControlScript(service("mysql"), "start"), /Stop-Service/);
    assert.doesNotMatch(windowsControlScript(service("mysql"), "stop"), /Start-Service/);
  });
});
