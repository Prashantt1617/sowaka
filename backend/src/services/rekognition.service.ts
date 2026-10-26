import { randomUUID } from 'node:crypto';
import {
  CreateCollectionCommand,
  CreateFaceLivenessSessionCommand,
  DeleteFacesCommand,
  DescribeCollectionCommand,
  DetectFacesCommand,
  GetFaceLivenessSessionResultsCommand,
  IndexFacesCommand,
  RekognitionClient,
  SearchFacesByImageCommand,
  type FaceDetail,
} from '@aws-sdk/client-rekognition';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { env } from '../config/env';

/**
 * Amazon Rekognition, as Face ID uses it: a collection per company, faces
 * indexed by user id, a search per punch, and Face Liveness sessions.
 *
 * Every call has a time limit and is retried on throttling and network errors
 * by the SDK's standard retry mode; whatever still fails for want of the
 * service comes out as `FaceServiceUnavailable`, which the punch treats like
 * a failed check rather than a crash. Swapped for a fake in the check script.
 */
export interface FaceEngine {
  ensureCollection(collectionId: string): Promise<void>;
  detectFaces(image: Buffer): Promise<DetectedFace[]>;
  /** Indexes the largest face; null when Rekognition found none it would keep. */
  indexFace(collectionId: string, image: Buffer, externalImageId: string): Promise<{ faceId: string } | null>;
  /** Faces in the collection like the largest face in the image, best first; null when the image has no face. */
  searchFace(collectionId: string, image: Buffer, threshold: number): Promise<FaceMatch[] | null>;
  deleteFaces(collectionId: string, faceIds: string[]): Promise<void>;
  createLivenessSession(): Promise<string>;
  livenessResult(sessionId: string): Promise<LivenessResult>;
}

export interface DetectedFace {
  confidence: number;
  /** Share of the image's width and height, 0-1. */
  width: number;
  height: number;
  brightness?: number;
  sharpness?: number;
  yaw?: number;
  pitch?: number;
  roll?: number;
  eyesOpen?: { value: boolean; confidence: number };
  occluded?: { value: boolean; confidence: number };
  sunglasses?: { value: boolean; confidence: number };
}

export interface FaceMatch {
  faceId: string;
  externalImageId?: string;
  similarity: number;
}

export interface LivenessResult {
  status: string;
  confidence?: number;
  /** The frame Rekognition picked, to match against the enrolled face. */
  referenceImage?: Buffer;
}

/** Rekognition could not be reached, or refused for reasons of its own. */
export class FaceServiceUnavailable extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'FaceServiceUnavailable';
  }
}

/** Errors that say something about the image or the collection, not the service. */
const IMAGE_ERRORS = new Set(['InvalidParameterException', 'InvalidImageFormatException', 'ImageTooLargeException']);

let engine: FaceEngine | undefined;

export function faceEngine(): FaceEngine {
  engine ??= createRekognitionEngine();
  return engine;
}

/** For the check script: a fake in place of Rekognition. */
export function setFaceEngineForTests(fake: FaceEngine | undefined) {
  engine = fake;
}

export function createRekognitionEngine(options: {
  /** Ignore the S3 keys and use the default chain (a profile, the host's role). */
  defaultCredentials?: boolean;
  region?: string;
} = {}): FaceEngine {
  const keys = !options.defaultCredentials && env.s3.accessKeyId && env.s3.secretAccessKey
    ? {
        credentials: {
          accessKeyId: env.s3.accessKeyId,
          secretAccessKey: env.s3.secretAccessKey,
          ...(env.s3.sessionToken ? { sessionToken: env.s3.sessionToken } : {}),
        },
      }
    : {};
  const client = new RekognitionClient({
    region: options.region ?? env.face.region,
    ...keys,
    maxAttempts: env.face.retries + 1,
    retryMode: 'standard',
    requestHandler: new NodeHttpHandler({
      connectionTimeout: Math.min(3000, env.face.timeoutMs),
      requestTimeout: env.face.timeoutMs,
    }),
  });

  async function send<T>(label: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const name = (error as { name?: string })?.name ?? '';
      if (IMAGE_ERRORS.has(name) || name === 'ResourceNotFoundException' || name === 'ResourceAlreadyExistsException'
        || name === 'SessionNotFoundException') {
        throw error;
      }
      throw new FaceServiceUnavailable(`Rekognition ${label} failed: ${name || 'error'}`, error);
    }
  }

  return {
    async ensureCollection(collectionId) {
      try {
        await send('DescribeCollection', () => client.send(new DescribeCollectionCommand({ CollectionId: collectionId })));
        return;
      } catch (error) {
        if ((error as { name?: string }).name !== 'ResourceNotFoundException') throw error;
      }
      try {
        await send('CreateCollection', () => client.send(new CreateCollectionCommand({ CollectionId: collectionId })));
      } catch (error) {
        // Two enrolments at once both found it missing; one made it.
        if ((error as { name?: string }).name !== 'ResourceAlreadyExistsException') throw error;
      }
    },

    async detectFaces(image) {
      const result = await send('DetectFaces', () =>
        client.send(new DetectFacesCommand({
          Image: { Bytes: image },
          Attributes: ['DEFAULT', 'EYES_OPEN', 'FACE_OCCLUDED', 'SUNGLASSES'],
        })),
      ).catch((error) => {
        if (IMAGE_ERRORS.has((error as { name?: string }).name ?? '')) return { FaceDetails: [] };
        throw error;
      });
      return (result.FaceDetails ?? []).map(detected);
    },

    async indexFace(collectionId, image, externalImageId) {
      const result = await send('IndexFaces', () =>
        client.send(new IndexFacesCommand({
          CollectionId: collectionId,
          Image: { Bytes: image },
          ExternalImageId: externalImageId,
          MaxFaces: 1,
          QualityFilter: 'AUTO',
          DetectionAttributes: [],
        })),
      ).catch((error) => {
        if (IMAGE_ERRORS.has((error as { name?: string }).name ?? '')) return { FaceRecords: [] };
        throw error;
      });
      const faceId = result.FaceRecords?.[0]?.Face?.FaceId;
      return faceId ? { faceId } : null;
    },

    async searchFace(collectionId, image, threshold) {
      try {
        const result = await send('SearchFacesByImage', () =>
          client.send(new SearchFacesByImageCommand({
            CollectionId: collectionId,
            Image: { Bytes: image },
            FaceMatchThreshold: threshold,
            MaxFaces: 3,
            QualityFilter: 'AUTO',
          })),
        );
        return (result.FaceMatches ?? [])
          .filter((match) => match.Face?.FaceId)
          .map((match) => ({
            faceId: match.Face!.FaceId!,
            externalImageId: match.Face?.ExternalImageId,
            similarity: match.Similarity ?? 0,
          }))
          .sort((a, b) => b.similarity - a.similarity);
      } catch (error) {
        const name = (error as { name?: string }).name ?? '';
        // "There are no faces in the image", or one too poor to search with.
        if (IMAGE_ERRORS.has(name)) return null;
        // No collection yet: nobody in the company has enrolled.
        if (name === 'ResourceNotFoundException') return [];
        throw error;
      }
    },

    async deleteFaces(collectionId, faceIds) {
      if (faceIds.length === 0) return;
      try {
        await send('DeleteFaces', () => client.send(new DeleteFacesCommand({ CollectionId: collectionId, FaceIds: faceIds })));
      } catch (error) {
        // The collection is gone, and the faces with it.
        if ((error as { name?: string }).name !== 'ResourceNotFoundException') throw error;
      }
    },

    async createLivenessSession() {
      const result = await send('CreateFaceLivenessSession', () =>
        client.send(new CreateFaceLivenessSessionCommand({
          ClientRequestToken: randomUUID(),
          // No audit frames: only the reference frame is needed, and it comes
          // back with the result rather than being written to a bucket.
          Settings: { AuditImagesLimit: 0 },
        })),
      );
      if (!result.SessionId) throw new FaceServiceUnavailable('Rekognition returned no liveness session');
      return result.SessionId;
    },

    async livenessResult(sessionId) {
      const result = await send('GetFaceLivenessSessionResults', () =>
        client.send(new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId })),
      );
      const bytes = result.ReferenceImage?.Bytes;
      return {
        status: result.Status ?? 'FAILED',
        confidence: result.Confidence,
        referenceImage: bytes ? Buffer.from(bytes) : undefined,
      };
    },
  };
}

function detected(face: FaceDetail): DetectedFace {
  const flag = (value?: { Value?: boolean; Confidence?: number }) =>
    value && typeof value.Value === 'boolean' ? { value: value.Value, confidence: value.Confidence ?? 0 } : undefined;
  return {
    confidence: face.Confidence ?? 0,
    width: face.BoundingBox?.Width ?? 0,
    height: face.BoundingBox?.Height ?? 0,
    brightness: face.Quality?.Brightness,
    sharpness: face.Quality?.Sharpness,
    yaw: face.Pose?.Yaw,
    pitch: face.Pose?.Pitch,
    roll: face.Pose?.Roll,
    eyesOpen: flag(face.EyesOpen),
    occluded: flag(face.FaceOccluded),
    sunglasses: flag(face.Sunglasses),
  };
}

/** A company's collection: `sowaka-<org>`, in the characters Rekognition allows. */
export function collectionIdFor(org: string): string {
  return `${env.face.collectionPrefix}${org}`.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 255);
}
