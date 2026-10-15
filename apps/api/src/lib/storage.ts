import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Private object storage (§14, §17): S3-compatible, private bucket, presigned PUT for uploads and
 * short-lived presigned GET for viewing. Nothing is ever public.
 */
export interface ObjectStorage {
  /** A URL the client PUTs the file to, with these headers. */
  presignPut(
    key: string,
    contentType: string,
    expiresInS: number,
  ): Promise<{ url: string; headers: Record<string, string> }>;
  /** A short-lived URL to view a private object. */
  presignGet(key: string, expiresInS: number): Promise<string>;
  /** Size and type of an uploaded object, or null if it is not there. */
  head(key: string): Promise<{ size: number; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

export interface S3Config {
  /** Where the API reaches storage (inside Docker: http://s3:8333). */
  endpoint: string;
  /** Where phones and browsers reach it, for presigned URLs. Defaults to `endpoint`. */
  publicEndpoint?: string | undefined;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

export function s3Storage(config: S3Config): ObjectStorage & { ensureBucket(): Promise<void> } {
  const client = (endpoint: string) =>
    new S3Client({
      endpoint,
      region: config.region ?? 'us-east-1',
      forcePathStyle: true, // SeaweedFS and most S3-compatible stores
      // The SDK would otherwise sign a checksum of the (empty) body into presigned upload URLs,
      // which the real upload can never match. Only add checksums where S3 requires them.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  const internal = client(config.endpoint);
  const signer = client(config.publicEndpoint ?? config.endpoint);
  const Bucket = config.bucket;

  return {
    async presignPut(key, contentType, expiresInS) {
      const url = await getSignedUrl(
        signer,
        new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }),
        { expiresIn: expiresInS },
      );
      return { url, headers: { 'content-type': contentType } };
    },
    presignGet(key, expiresInS) {
      return getSignedUrl(signer, new GetObjectCommand({ Bucket, Key: key }), {
        expiresIn: expiresInS,
      });
    },
    async head(key) {
      try {
        const res = await internal.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: res.ContentLength ?? 0, contentType: res.ContentType ?? '' };
      } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode;
        if (status === 404 || status === 403) return null;
        throw err;
      }
    },
    async delete(key) {
      await internal.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async ensureBucket() {
      try {
        await internal.send(new HeadBucketCommand({ Bucket }));
      } catch {
        await internal.send(new CreateBucketCommand({ Bucket }));
      }
    },
  };
}
