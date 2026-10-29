import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, realpath, stat, unlink } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import type { StorageAdapter, StorageObject, UploadGrant } from "./storage.js";

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const EVIDENCE_KEY_PATTERN = new RegExp(
  `^funds/${UUID_PATTERN}/expenses/${UUID_PATTERN}/evidence/${UUID_PATTERN}/[0-9a-f]{32}$`,
);

export function parseEvidenceObjectKey(key: string): string {
  if (!EVIDENCE_KEY_PATTERN.test(key)) {
    throw new Error("Invalid evidence object key");
  }
  return key;
}

function isWithinRoot(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..");
}

export class FileSystemStorageAdapter implements StorageAdapter {
  private constructor(private readonly root: string) {}

  static async open(rootDirectory: string): Promise<FileSystemStorageAdapter> {
    await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
    const root = await realpath(rootDirectory);
    if (!(await stat(root)).isDirectory()) {
      throw new Error("Evidence storage path must be a directory");
    }
    return new FileSystemStorageAdapter(root);
  }

  async putObject(key: string, data: Uint8Array, _mimeType: string): Promise<void> {
    const target = this.objectPath(key);
    const directory = dirname(target);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const realDirectory = await realpath(directory);
    if (!isWithinRoot(this.root, realDirectory)) {
      throw new Error("Evidence storage path escapes its configured directory");
    }

    const temporary = resolve(realDirectory, `.${basename(target)}.${randomUUID()}.tmp`);
    const file = await open(temporary, "wx", 0o600);
    let fileOpen = true;
    try {
      await file.writeFile(data);
      await file.sync();
      await file.close();
      fileOpen = false;

      await link(temporary, resolve(realDirectory, basename(target)));
      const directoryHandle = await open(realDirectory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } finally {
      if (fileOpen) await file.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
    }
  }

  async getObject(key: string): Promise<StorageObject> {
    const target = this.objectPath(key);
    const objectPath = await realpath(target);
    if (!isWithinRoot(this.root, objectPath)) {
      throw new Error("Evidence storage path escapes its configured directory");
    }
    const [data, info] = await Promise.all([readFile(objectPath), stat(objectPath)]);
    return {
      data: new Uint8Array(data),
      mimeType: "application/octet-stream",
      sizeBytes: data.byteLength,
      createdAt: info.mtime.toISOString(),
    };
  }

  async deleteObject(): Promise<never> {
    throw new Error("Evidence objects are immutable and cannot be deleted");
  }

  async createUploadGrant(): Promise<UploadGrant> {
    throw new Error("Filesystem storage does not issue direct upload grants");
  }

  private objectPath(key: string): string {
    const safeKey = parseEvidenceObjectKey(key);
    const path = resolve(this.root, safeKey);
    if (!isWithinRoot(this.root, path)) {
      throw new Error("Evidence storage path escapes its configured directory");
    }
    return path;
  }
}
