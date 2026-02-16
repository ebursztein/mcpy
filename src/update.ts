/**
 * Auto-update logic for mcpy.
 * Checks GitHub releases for newer versions, downloads, verifies SHA256, and replaces the binary.
 */
import { platform, arch, homedir } from "os";
import { join } from "path";
import { existsSync, renameSync, unlinkSync, chmodSync } from "fs";
import { VERSION } from "./version.ts";

const REPO = "ebursztein/mcpy";
const INSTALL_DIR = join(homedir(), ".mcpy", "bin");
const BINARY_PATH = join(INSTALL_DIR, "mcpy");

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
  downloadUrl: string;
  asset: string;
}

/** Map OS + arch to the GitHub release asset name */
export function getAssetName(): string {
  const os = platform();
  const cpu = arch();

  let p: string;
  switch (os) {
    case "darwin":
      p = "darwin";
      break;
    case "linux":
      p = "linux";
      break;
    default:
      throw new Error(`Unsupported platform: ${os}`);
  }

  let a: string;
  switch (cpu) {
    case "x64":
      a = "x64";
      break;
    case "arm64":
      a = "arm64";
      break;
    default:
      throw new Error(`Unsupported architecture: ${cpu}`);
  }

  return `mcpy-${p}-${a}`;
}

/** Compare two semver strings. Returns true if b is newer than a. */
function isNewer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pb[i] || 0) > (pa[i] || 0)) return true;
    if ((pb[i] || 0) < (pa[i] || 0)) return false;
  }
  return false;
}

/** Check GitHub releases for a newer version. Returns null if up to date. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const asset = getAssetName();

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": `mcpy/${VERSION}`,
      },
    }
  );

  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}: ${await res.text()}`);
  }

  const release = (await res.json()) as {
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string }>;
  };

  const latest = release.tag_name.replace(/^v/, "");

  if (!isNewer(VERSION, latest)) {
    return null;
  }

  const binaryAsset = release.assets.find((a) => a.name === asset);
  if (!binaryAsset) {
    throw new Error(
      `No release asset found for ${asset} in ${release.tag_name}`
    );
  }

  return {
    current: VERSION,
    latest,
    updateAvailable: true,
    downloadUrl: binaryAsset.browser_download_url,
    asset,
  };
}

/** Download, verify, and replace the binary. */
export async function performUpdate(info: UpdateInfo): Promise<void> {
  const tmpPath = BINARY_PATH + ".tmp";
  const backupPath = BINARY_PATH + ".bak";

  // 1. Download binary to temp file
  const res = await fetch(info.downloadUrl, {
    headers: { "User-Agent": `mcpy/${VERSION}` },
  });

  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }

  const data = await res.arrayBuffer();
  await Bun.write(tmpPath, data);

  // 2. Fetch SHA256SUMS and verify checksum
  const sumsUrl = info.downloadUrl.replace(
    /\/[^/]+$/,
    "/SHA256SUMS"
  );

  try {
    const sumsRes = await fetch(sumsUrl, {
      headers: { "User-Agent": `mcpy/${VERSION}` },
    });

    if (sumsRes.ok) {
      const sumsText = await sumsRes.text();
      const expectedLine = sumsText
        .split("\n")
        .find((line) => line.includes(info.asset));

      if (expectedLine) {
        const expectedHash = expectedLine.trim().split(/\s+/)[0];
        const hasher = new Bun.CryptoHasher("sha256");
        hasher.update(new Uint8Array(data));
        const actualHash = hasher.digest("hex");

        if (actualHash !== expectedHash) {
          unlinkSync(tmpPath);
          throw new Error(
            `Checksum mismatch: expected ${expectedHash}, got ${actualHash}`
          );
        }
      }
    }
    // If SHA256SUMS not found, skip verification (older releases may not have it)
  } catch (err) {
    // If the error is a checksum mismatch, re-throw it
    if (err instanceof Error && err.message.startsWith("Checksum mismatch")) {
      throw err;
    }
    // Otherwise, skip checksum verification
  }

  // 3. Atomic replace: backup old -> move new -> remove backup
  chmodSync(tmpPath, 0o755);

  if (existsSync(BINARY_PATH)) {
    try {
      renameSync(BINARY_PATH, backupPath);
    } catch {
      unlinkSync(tmpPath);
      throw new Error("Failed to backup current binary");
    }
  }

  try {
    renameSync(tmpPath, BINARY_PATH);
  } catch (err) {
    // Restore from backup on failure
    if (existsSync(backupPath)) {
      try {
        renameSync(backupPath, BINARY_PATH);
      } catch {
        // Best effort restore
      }
    }
    unlinkSync(tmpPath);
    throw new Error(
      `Failed to install new binary: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 4. Remove backup
  if (existsSync(backupPath)) {
    try {
      unlinkSync(backupPath);
    } catch {
      // Non-critical
    }
  }
}

/** Get version info for the API. */
export async function getVersionInfo(): Promise<{
  current: string;
  latest: string | null;
  updateAvailable: boolean;
}> {
  try {
    const update = await checkForUpdate();
    if (update) {
      return {
        current: VERSION,
        latest: update.latest,
        updateAvailable: true,
      };
    }
    return { current: VERSION, latest: VERSION, updateAvailable: false };
  } catch {
    return { current: VERSION, latest: null, updateAvailable: false };
  }
}
