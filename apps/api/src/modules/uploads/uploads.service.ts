import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  type Env,
  type PresignedUploadDto,
  type SignUploadInput,
  UPLOAD_TYPES,
} from '@markethub/shared';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { InjectEnv } from '../../config/env.validation';

const SIGNED_URL_TTL_S = 300;
export type UploadPurpose = SignUploadInput['purpose'];

/**
 * Browsers upload straight to the bucket with a short-lived presigned PUT
 * (§4 POST /images/sign). Type and exact byte length are part of the
 * signature, so the client can't swap in something else (§9).
 * Keys are `${purpose}/${userId}/${uuid}.${ext}`: ownership is the prefix.
 */
@Injectable()
export class UploadsService implements OnModuleInit {
  private readonly logger = new Logger(UploadsService.name);
  private readonly s3: S3Client | null;
  private readonly bucket: string;
  /** Verification documents; never publicly readable (Phase 6). */
  private readonly privateBucket: string | null;
  readonly publicBase: string;

  constructor(@InjectEnv() private readonly env: Env) {
    const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = env;
    this.bucket = S3_BUCKET ?? '';
    this.privateBucket = env.S3_PRIVATE_BUCKET ?? null;
    this.publicBase = (env.S3_PUBLIC_URL ?? `${S3_ENDPOINT}/${S3_BUCKET}`).replace(/\/+$/, '');
    this.s3 =
      S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY && S3_SECRET_KEY
        ? new S3Client({
            endpoint: S3_ENDPOINT,
            region: env.S3_REGION,
            forcePathStyle: true, // R2, MinIO and SeaweedFS all accept path style
            credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
            // SDK ≥3.729 otherwise signs a CRC32 into every presigned PUT, computed over
            // an empty body (the photo doesn't exist yet), and R2/S3 reject the real upload
            // as a checksum mismatch. SeaweedFS ignores it, which is why local tests passed.
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
          })
        : null;
  }

  /** Dev/test buckets get CORS for the web origin; production buckets are configured in infra. */
  async onModuleInit() {
    if (!this.s3 || this.env.NODE_ENV === 'production') return;
    for (const Bucket of [this.bucket, this.privateBucket].filter((b): b is string => !!b)) {
      await this.corsFor(Bucket);
    }
  }

  private async corsFor(Bucket: string) {
    await this.s3!.send(
      new PutBucketCorsCommand({
        Bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: [this.env.WEB_URL],
              AllowedMethods: ['PUT', 'GET'],
              AllowedHeaders: ['content-type'],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    ).catch((err: unknown) => this.logger.warn({ err }, 'Could not set dev bucket CORS'));
  }

  get enabled() {
    return this.s3 !== null;
  }

  async sign(userId: string, input: SignUploadInput): Promise<PresignedUploadDto> {
    const s3 = this.client();
    const key = `${input.purpose}/${userId}/${randomUUID()}.${UPLOAD_TYPES[input.contentType]}`;
    const isPrivate = input.purpose === 'verification';
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: isPrivate ? this.privateBucketOrThrow() : this.bucket,
        Key: key,
        ContentType: input.contentType,
        ContentLength: input.size,
        CacheControl: isPrivate ? 'private, no-store' : 'public, max-age=31536000, immutable',
      }),
      {
        expiresIn: SIGNED_URL_TTL_S,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return {
      uploadUrl,
      publicUrl: isPrivate ? null : `${this.publicBase}/${key}`,
      key,
      expiresIn: SIGNED_URL_TTL_S,
    };
  }

  /** The key for a URL we issued to this user for this purpose, or null. */
  keyFor(url: string, userId: string, purpose: UploadPurpose): string | null {
    const prefix = `${this.publicBase}/${purpose}/${userId}/`;
    if (!url.startsWith(prefix)) return null;
    const rest = url.slice(prefix.length);
    return /^[0-9a-f-]{36}\.(jpg|png|webp|mp4)$/.test(rest) ? `${purpose}/${userId}/${rest}` : null;
  }

  /**
   * Every URL must be one we signed for this user, and the object must
   * actually exist — otherwise listings end up with broken or foreign images.
   */
  async assertUploaded(urls: string[], userId: string, purpose: UploadPurpose) {
    if (!urls.length) return;
    const s3 = this.client();
    const keys = urls.map((url) => {
      const key = this.keyFor(url, userId, purpose);
      if (!key)
        throw new BadRequestException({ message: 'Unknown upload', fields: { images: [url] } });
      return key;
    });
    const missing = await Promise.all(
      keys.map((Key) =>
        s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key })).then(
          () => null,
          () => Key,
        ),
      ),
    );
    if (missing.some(Boolean)) {
      throw new BadRequestException('Some uploads did not finish — try adding those photos again');
    }
  }

  /** Private keys this user uploaded and that exist; returns them normalised. */
  async assertPrivateUploaded(keys: string[], userId: string): Promise<string[]> {
    const s3 = this.client();
    const Bucket = this.privateBucketOrThrow();
    const pattern = new RegExp(`^verification/${userId}/[0-9a-f-]{36}\\.(jpg|png|webp)$`);
    for (const key of keys) {
      if (!pattern.test(key)) {
        throw new BadRequestException({ message: 'Unknown upload', fields: { documents: [key] } });
      }
    }
    const missing = await Promise.all(
      keys.map((Key) =>
        s3.send(new HeadObjectCommand({ Bucket, Key })).then(
          () => null,
          () => Key,
        ),
      ),
    );
    if (missing.some(Boolean)) {
      throw new BadRequestException('A document didn’t finish uploading — add it again');
    }
    return keys;
  }

  /** A five-minute read link for an admin reviewing a private document. */
  signedRead(key: string): Promise<string> {
    return getSignedUrl(
      this.client(),
      new GetObjectCommand({ Bucket: this.privateBucketOrThrow(), Key: key }),
      { expiresIn: SIGNED_URL_TTL_S },
    );
  }

  private privateBucketOrThrow(): string {
    if (!this.privateBucket) {
      throw new ServiceUnavailableException('Document uploads are not configured');
    }
    return this.privateBucket;
  }

  private client(): S3Client {
    if (!this.s3) throw new ServiceUnavailableException('Uploads are not configured');
    return this.s3;
  }
}
