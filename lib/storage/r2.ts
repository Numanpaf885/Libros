import "server-only";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireEnv } from "../config";
import { StorageUnavailableError } from "../db/errors";
import { GET_TTL_S, PUT_TTL_S } from "./constants";

/** Every R2 request gives up after this long (presigning is local and needs none): a slow R2 never hangs a page. */
export const R2_TIMEOUT_MS = 5_000;
/** Completing a multipart upload (the admin's original PDF) can take R2 longer: admin-only, never on a page's path. */
const COMPLETE_TIMEOUT_MS = 30_000;
const limited = (ms = R2_TIMEOUT_MS) => ({ abortSignal: AbortSignal.timeout(ms) });
/** Runs one R2 request with its time limit; a timeout becomes StorageUnavailableError (503 + "Reintentar"). */
async function timed<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "AbortError" || name === "TimeoutError") throw new StorageUnavailableError({ cause: e });
    throw e;
  }
}

let client: S3Client | null = null;
function s3(): S3Client {
  client ??= new S3Client({
    region: "auto", // R2 ignores the region but the SDK requires one
    endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
    // Newer SDKs add CRC32 checksum headers by default, which a browser PUT to a
    // presigned URL would not send. Only compute checksums when an operation needs one.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 2, // one retry at most: with the time limit below, a request never waits more than R2_TIMEOUT_MS
    requestHandler: { connectionTimeout: 3_000, requestTimeout: R2_TIMEOUT_MS },
  });
  return client;
}
const bucket = () => requireEnv("R2_BUCKET");

export async function presignPut(key: string, contentType = "image/webp"): Promise<string> {
  // content-type is marked unhoistable so it ends up in X-Amz-SignedHeaders: R2 then rejects a
  // PUT that does not send exactly that Content-Type (image/webp for pages; the uploader always sends it).
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }), {
    expiresIn: PUT_TTL_S,
    unhoistableHeaders: new Set(["content-type"]),
    signableHeaders: new Set(["content-type"]),
  });
}
export async function presignGet(key: string, ttl = GET_TTL_S): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: ttl });
}
export async function list(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const r = await timed(() => s3().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: `${prefix}/`, ContinuationToken: token }), limited()));
    for (const o of r.Contents ?? []) if (o.Key) out.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}
export async function deletePrefix(prefix: string): Promise<number> {
  let total = 0;
  // Always list from the start: deleting while following a continuation token can skip keys.
  for (;;) {
    const r = await timed(() => s3().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: `${prefix}/`, MaxKeys: 1000 }), limited()));
    const keys = (r.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
    if (!keys.length) return total;
    // One listing page (<= 1000 keys) -> one DeleteObjects batch.
    const d = await timed(() => s3().send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: keys, Quiet: true } }), limited()));
    if (d.Errors?.length) throw new Error("delete failed");
    total += keys.length;
  }
}

export async function listSizes(prefix: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  let token: string | undefined;
  do {
    const r = await timed(() => s3().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: `${prefix}/`, ContinuationToken: token }), limited()));
    for (const o of r.Contents ?? []) if (o.Key) out[o.Key] = o.Size ?? 0;
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}
export async function head(key: string): Promise<number | null> {
  try {
    const r = await timed(() => s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }), limited()));
    return r.ContentLength ?? 0;
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw e;
  }
}
export async function readText(key: string): Promise<string | null> {
  try {
    const r = await timed(() => s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }), limited()));
    return r.Body ? await r.Body.transformToString("utf-8") : "";
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw e;
  }
}
export async function deleteKey(key: string): Promise<void> {
  await timed(() => s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }), limited()));
}
export async function presignDownload(key: string, filename: string, ttl = GET_TTL_S): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({
    Bucket: bucket(), Key: key,
    ResponseContentDisposition: `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
    ResponseContentType: "application/pdf",
  }), { expiresIn: ttl });
}

export async function createMultipart(key: string): Promise<string> {
  const r = await timed(() => s3().send(new CreateMultipartUploadCommand({ Bucket: bucket(), Key: key, ContentType: "application/pdf" }), limited()));
  if (!r.UploadId) throw new Error("no upload id");
  return r.UploadId;
}
export async function presignPart(key: string, uploadId: string, part: number): Promise<string> {
  return getSignedUrl(s3(), new UploadPartCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, PartNumber: part }), { expiresIn: PUT_TTL_S });
}
export async function listParts(key: string, uploadId: string): Promise<{ part: number; size: number; etag: string }[]> {
  const out: { part: number; size: number; etag: string }[] = [];
  let marker: string | undefined;
  for (;;) {
    const r = await timed(() => s3().send(new ListPartsCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, PartNumberMarker: marker }), limited()));
    for (const p of r.Parts ?? []) if (p.PartNumber && p.ETag) out.push({ part: p.PartNumber, size: p.Size ?? 0, etag: p.ETag });
    if (!r.IsTruncated || r.NextPartNumberMarker == null) return out;
    marker = String(r.NextPartNumberMarker);
  }
}
export async function completeMultipart(key: string, uploadId: string, parts: { part: number; etag: string }[]): Promise<void> {
  await timed(() => s3().send(new CompleteMultipartUploadCommand({
    Bucket: bucket(), Key: key, UploadId: uploadId,
    MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.part, ETag: p.etag })).sort((a, b) => a.PartNumber - b.PartNumber) },
  }), limited(COMPLETE_TIMEOUT_MS)));
}
export async function abortMultipart(key: string, uploadId: string): Promise<void> {
  try {
    await timed(() => s3().send(new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }), limited()));
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 404) throw e; // already gone is fine
  }
}
/** For /api/health: one tiny request to the bucket (list one key), within R2_TIMEOUT_MS. */
export async function ping(): Promise<void> {
  await timed(() => s3().send(new ListObjectsV2Command({ Bucket: bucket(), MaxKeys: 1 }), limited()));
}
