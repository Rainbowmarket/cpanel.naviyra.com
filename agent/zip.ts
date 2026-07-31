/**
 * Safe ZIP extraction (Zip Slip protected).
 * Never falls back to raw `unzip` / unchecked Expand-Archive.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const isWindows = process.platform === "win32";

function isZipSlipError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /zip-slip/i.test(msg);
}

async function extractWithPython(zipPath: string, destDir: string) {
  const script = `
import zipfile, pathlib, sys, os
zip_path = pathlib.Path(sys.argv[1]).resolve()
dest = pathlib.Path(sys.argv[2]).resolve()
dest.mkdir(parents=True, exist_ok=True)
root = str(dest) + os.sep
with zipfile.ZipFile(zip_path, "r") as zf:
    for info in zf.infolist():
        name = info.filename.replace("\\\\", "/")
        if not name or name.startswith("/") or name.startswith("../") or "/../" in name:
            raise SystemExit(f"zip-slip: {name}")
        target = (dest / name).resolve()
        if not (str(target) == str(dest) or str(target).startswith(root)):
            raise SystemExit(f"zip-slip: {name}")
        if name.endswith("/") or info.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, open(target, "wb") as out:
            out.write(src.read())
print("ok")
`;
  try {
    await exec("python3", ["-c", script, zipPath, destDir], {
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    // Prefer `python` on some hosts (e.g. Windows with python.org installer)
    if (isZipSlipError(error)) throw error;
    await exec("python", ["-c", script, zipPath, destDir], {
      maxBuffer: 20 * 1024 * 1024,
    });
  }
}

/**
 * Windows: System.IO.Compression with path containment.
 * Paths are passed as -File script args (no string interpolation into the script).
 */
async function extractWithPowershellSafe(zipPath: string, destDir: string) {
  const script = `
param(
  [Parameter(Mandatory=$true)][string]$ZipPath,
  [Parameter(Mandatory=$true)][string]$DestDir
)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$dest = [System.IO.Path]::GetFullPath($DestDir)
[void][System.IO.Directory]::CreateDirectory($dest)
$rootPrefix = if ($dest.EndsWith([System.IO.Path]::DirectorySeparatorChar)) { $dest } else { $dest + [System.IO.Path]::DirectorySeparatorChar }
$zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName
    if ([string]::IsNullOrWhiteSpace($name)) { continue }
    if ($name.StartsWith('/') -or $name.StartsWith('\\') -or $name.Contains('..')) {
      throw "zip-slip: $name"
    }
    $target = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($dest, $name))
    if ($target -ne $dest -and -not $target.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "zip-slip: $name"
    }
    if ($name.EndsWith('/') -or $name.EndsWith('\\')) {
      [void][System.IO.Directory]::CreateDirectory($target)
      continue
    }
    $parent = [System.IO.Path]::GetDirectoryName($target)
    if ($parent) { [void][System.IO.Directory]::CreateDirectory($parent) }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
  }
} finally {
  $zip.Dispose()
}
`;
  const ps1 = path.join(
    os.tmpdir(),
    `naviyra-unzip-${process.pid}-${Date.now()}.ps1`
  );
  await fs.writeFile(ps1, script, "utf8");
  try {
    await exec(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        ps1,
        "-ZipPath",
        zipPath,
        "-DestDir",
        destDir,
      ],
      { maxBuffer: 20 * 1024 * 1024 }
    );
  } finally {
    await fs.rm(ps1, { force: true });
  }
}

/**
 * Extract zip into destDir with Zip Slip protection.
 */
export async function extractZipArchive(
  zipPath: string,
  destDir: string,
  options?: { removeZip?: boolean }
): Promise<{ extractedTo: string; removedZip: boolean }> {
  const zipAbs = path.resolve(zipPath);
  const destAbs = path.resolve(destDir);
  if (!fsSync.existsSync(zipAbs)) {
    throw new Error(`ZIP not found: ${zipAbs}`);
  }
  await fs.mkdir(destAbs, { recursive: true });

  try {
    if (isWindows) {
      try {
        await extractWithPython(zipAbs, destAbs);
      } catch (error) {
        if (isZipSlipError(error)) throw error;
        await extractWithPowershellSafe(zipAbs, destAbs);
      }
    } else {
      await extractWithPython(zipAbs, destAbs);
    }
  } catch (error) {
    if (isZipSlipError(error)) {
      throw new Error(
        error instanceof Error ? error.message : "Zip Slip blocked"
      );
    }
    throw new Error(
      `Safe ZIP extraction failed (python3 required on Linux). ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  let removedZip = false;
  if (options?.removeZip !== false) {
    await fs.rm(zipAbs, { force: true });
    removedZip = true;
  }

  return { extractedTo: destAbs, removedZip };
}

export function isZipFileName(name: string): boolean {
  return /\.zip$/i.test(name.trim());
}
