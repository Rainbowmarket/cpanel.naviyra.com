/**
 * Safe ZIP extraction (Zip Slip protected)
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const isWindows = process.platform === "win32";

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
        if not name:
            continue
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
  await exec("python3", ["-c", script, zipPath, destDir], {
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function extractWithPowershell(zipPath: string, destDir: string) {
  await fs.mkdir(destDir, { recursive: true });
  await exec(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
    ],
    { maxBuffer: 20 * 1024 * 1024 }
  );
}

/**
 * Extract zip into destDir.
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

  if (isWindows) {
    await extractWithPowershell(zipAbs, destAbs);
  } else {
    try {
      await extractWithPython(zipAbs, destAbs);
    } catch {
      await exec("unzip", ["-o", "-q", zipAbs, "-d", destAbs], {
        maxBuffer: 20 * 1024 * 1024,
      });
    }
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
