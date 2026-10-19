// S3 transport only. Channel policy and filesystem trust belong to media-remote.ts.
import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand,
  GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, UploadPartCommand,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import type { Readable } from "node:stream";

export interface MediaObjectStore {
  head(key: string): Promise<{ size: number } | undefined>;
  /** The caller supplies a private, hash-verified snapshot. False means another writer won. */
  put(key: string, file: string, entry: { hash: string; size: number }): Promise<boolean>;
  get(key: string): Promise<Readable>;
  close?(): void;
}

export interface S3MediaOptions {
  bucket: string;
  endpoint?: string;
  region: string;
  forcePathStyle?: boolean;
  checksum?: boolean;
  signal?: AbortSignal;
}

const status = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
const checksum = (data: Buffer) => createHash("sha256").update(data).digest("base64");
const PART_SIZE = 8 * 1024 * 1024;

/** Standard AWS credential chain (environment, profiles, workload credentials); no repository secrets. */
export function s3MediaStore(options: S3MediaOptions): MediaObjectStore {
  const client = new S3Client({
    region: options.region,
    endpoint: options.endpoint,
    forcePathStyle: options.forcePathStyle ?? true,
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 120_000, throwOnRequestTimeout: true },
    // Do not silently add CRC headers when a compatible provider disables checksums.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const sendOptions = { abortSignal: options.signal };
  const Bucket = options.bucket;
  const checksums = options.checksum !== false;
  return {
    async head(Key) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket, Key }), sendOptions);
        if (result.ContentLength === undefined) throw new Error("S3 HEAD returned no content length");
        return { size: result.ContentLength };
      } catch (error) {
        if (status(error) === 404) return undefined;
        throw error; // 403, timeouts and service failures are not missing objects.
      }
    },
    async get(Key) {
      const result = await client.send(new GetObjectCommand({ Bucket, Key }), sendOptions);
      if (!result.Body) throw new Error("S3 GET returned no body");
      return result.Body as Readable;
    },
    async put(Key, file, entry) {
      if (entry.size <= PART_SIZE) {
        const body = createReadStream(file);
        try {
          await client.send(new PutObjectCommand({
            Bucket, Key, Body: body, ContentLength: entry.size, IfNoneMatch: "*",
            ...(checksums ? { ChecksumSHA256: Buffer.from(entry.hash.slice(7), "hex").toString("base64") } : {}),
          }), sendOptions);
          return true;
        } catch (error) {
          if (status(error) === 412) return false;
          throw error;
        } finally { body.destroy(); }
      }

      // Sequential parts per object; the outer file pool bounds aggregate memory/connections.
      // Size grows only to respect S3's 10,000-part ceiling. A rerun resumes at object granularity.
      const created = await client.send(new CreateMultipartUploadCommand({
        Bucket, Key, ...(checksums ? { ChecksumAlgorithm: "SHA256", ChecksumType: "COMPOSITE" } : {}),
      }), sendOptions);
      const UploadId = created.UploadId;
      if (!UploadId) throw new Error("S3 did not return a multipart upload ID");
      try {
        const handle = await open(file, "r");
        const parts: CompletedPart[] = [];
        const partSize = Math.max(PART_SIZE, Math.ceil(entry.size / 10_000));
        try {
          for (let offset = 0, PartNumber = 1; offset < entry.size; offset += partSize, PartNumber++) {
            const body = Buffer.allocUnsafe(Math.min(partSize, entry.size - offset));
            let filled = 0;
            while (filled < body.length) {
              const { bytesRead } = await handle.read(body, filled, body.length - filled, offset + filled);
              if (!bytesRead) throw new Error("Upload snapshot was truncated");
              filled += bytesRead;
            }
            const ChecksumSHA256 = checksums ? checksum(body) : undefined;
            const part = await client.send(new UploadPartCommand({
              Bucket, Key, UploadId, PartNumber, Body: body, ContentLength: body.length, ChecksumSHA256,
            }), sendOptions);
            if (!part.ETag) throw new Error("S3 upload part returned no ETag");
            parts.push({ PartNumber, ETag: part.ETag, ...(checksums ? { ChecksumSHA256 } : {}) });
          }
        } finally { await handle.close(); }
        // No ChecksumType here: CreateMultipartUpload declared it, and Garage refuses it on completion.
        await client.send(new CompleteMultipartUploadCommand({
          Bucket, Key, UploadId, MultipartUpload: { Parts: parts }, IfNoneMatch: "*",
        }), sendOptions);
        return true;
      } catch (error) {
        // Use an un-aborted request for cleanup, even when the transfer was cancelled.
        await client.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId })).catch(() => { /* Preserve the transfer failure; bucket lifecycle cleans abandoned uploads. */ });
        if (status(error) === 412) return false;
        throw error;
      }
    },
    close() { client.destroy(); },
  };
}
