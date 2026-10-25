import fs from 'fs';
import path from 'path';

export interface StorageOptions {
  maxAgeMs?: number;
  retries?: number;
  delayMs?: number;
}

/**
 * Safely unlinks a file with retries and backoff to tolerate
 * transient Windows file locks (EBUSY, EPERM, EACCES).
 */
export async function safeUnlink(filePath: string, retries = 5, delayMs = 40): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
      return;
    } catch (err: any) {
      if (attempt < retries - 1 && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
      } else {
        return;
      }
    }
  }
}

/**
 * Synchronous version of safeUnlink for use during synchronous initialization.
 */
export function safeUnlinkSync(filePath: string, retries = 5, delayMs = 30): void {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return;
    } catch (err: any) {
      if (attempt < retries - 1 && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
        const start = Date.now();
        const wait = delayMs * (attempt + 1);
        while (Date.now() - start < wait) {
          // brief synchronous wait
        }
      } else {
        return;
      }
    }
  }
}

/**
 * Cleans up stale temporary files matching `${baseFile}.tmp.*` older than maxAgeMs.
 */
export async function cleanupStaleTempFiles(targetFilePath: string, maxAgeMs = 60000): Promise<void> {
  try {
    const dir = path.dirname(targetFilePath);
    if (!fs.existsSync(dir)) return;
    const baseName = path.basename(targetFilePath);
    const prefix = `${baseName}.tmp.`;
    const entries = await fs.promises.readdir(dir);
    const now = Date.now();

    for (const entry of entries) {
      if (entry.startsWith(prefix)) {
        const fullPath = path.join(dir, entry);
        try {
          const stat = await fs.promises.stat(fullPath);
          if (now - stat.mtimeMs >= maxAgeMs) {
            await safeUnlink(fullPath);
          }
        } catch {
          // Ignore concurrent unlink/stat races
        }
      }
    }
  } catch {
    // Non-fatal cleanup error
  }
}

/**
 * Synchronous version of cleanupStaleTempFiles for constructors.
 */
export function cleanupStaleTempFilesSync(targetFilePath: string, maxAgeMs = 60000): void {
  try {
    const dir = path.dirname(targetFilePath);
    if (!fs.existsSync(dir)) return;
    const baseName = path.basename(targetFilePath);
    const prefix = `${baseName}.tmp.`;
    const entries = fs.readdirSync(dir);
    const now = Date.now();

    for (const entry of entries) {
      if (entry.startsWith(prefix)) {
        const fullPath = path.join(dir, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (now - stat.mtimeMs >= maxAgeMs) {
            safeUnlinkSync(fullPath);
          }
        } catch {
          // Ignore concurrent unlink/stat races
        }
      }
    }
  } catch {
    // Non-fatal cleanup error
  }
}

/**
 * Sweeps and deletes ALL orphaned .tmp.* files in a directory older than maxAgeMs.
 * Returns the number of files swept.
 */
export function sweepAllTempFilesSync(directoryPath: string, maxAgeMs = 0): number {
  if (!fs.existsSync(directoryPath)) return 0;
  let sweptCount = 0;
  const now = Date.now();
  try {
    const entries = fs.readdirSync(directoryPath);
    for (const entry of entries) {
      if (entry.includes('.tmp.')) {
        const fullPath = path.join(directoryPath, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (now - stat.mtimeMs >= maxAgeMs) {
            safeUnlinkSync(fullPath);
            sweptCount++;
          }
        } catch {
          // Ignore race
        }
      }
    }
  } catch (err) {
    console.warn(`Failed sweeping temp files in ${directoryPath}:`, err);
  }
  return sweptCount;
}

/**
 * Atomic JSON write with collision-resistant temp name, rename fallback,
 * safeUnlink with retries, and guaranteed finally cleanup.
 */
export async function atomicWriteJson(
  filePath: string,
  data: any,
  options: { space?: number } = { space: 2 }
): Promise<void> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const serialized = options.space ? JSON.stringify(data, null, options.space) : JSON.stringify(data);
  const tempPath = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  try {
    await fs.promises.writeFile(tempPath, serialized, 'utf-8');
    try {
      await fs.promises.rename(tempPath, filePath);
    } catch {
      await fs.promises.copyFile(tempPath, filePath);
      await safeUnlink(tempPath);
    }
  } catch (err) {
    try {
      await fs.promises.writeFile(filePath, serialized, 'utf-8');
    } catch (directErr) {
      console.error(`Direct write fallback failed for ${filePath}:`, directErr);
      throw directErr;
    }
  } finally {
    await safeUnlink(tempPath);
  }
}

/**
 * Synchronous atomic write with collision-resistant temp name, rename fallback,
 * safeUnlinkSync with retries, and guaranteed finally cleanup.
 */
export function safeAtomicWriteSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tempPath = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  try {
    fs.writeFileSync(tempPath, content, 'utf-8');
    try {
      fs.renameSync(tempPath, filePath);
    } catch {
      fs.copyFileSync(tempPath, filePath);
      safeUnlinkSync(tempPath);
    }
  } catch (err) {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
    } catch (directErr) {
      console.error(`Direct write fallback failed for ${filePath}:`, directErr);
      throw directErr;
    }
  } finally {
    safeUnlinkSync(tempPath);
  }
}

/**
 * Safely appends data to a file with retries to tolerate Windows file locks (EBUSY, EPERM, EACCES).
 */
export async function safeAppendFile(
  filePath: string,
  data: string,
  retries = 5,
  delayMs = 40
): Promise<void> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await fs.promises.appendFile(filePath, data, 'utf-8');
      return;
    } catch (err: any) {
      if (
        attempt < retries - 1 &&
        (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')
      ) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
      } else {
        throw err;
      }
    }
  }
}

// Automatically sweep stale/orphaned temporary files on module load
try {
  const canonicalDataDir = path.resolve(__dirname, '../../data');
  if (fs.existsSync(canonicalDataDir)) {
    sweepAllTempFilesSync(canonicalDataDir, 0);
  }
  const envDataDir = process.env.DATA_DIR;
  if (envDataDir && fs.existsSync(envDataDir)) {
    sweepAllTempFilesSync(envDataDir, 0);
  }
} catch {
  // Ignore startup sweep errors
}
