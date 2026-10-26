/**
 * Face ID against real Amazon Rekognition, in its own test collection
 * (`sowaka-test-faces`), which it creates and always deletes. Enrols the
 * first photo through the same quality gate as the app's enrolment, then
 * searches with the others: the same person must match at the pass mark, a
 * different person must not. Openly licensed or synthetic photos only, never
 * an employee's. Run outside the backend folder, so no .env keys are picked
 * up, with a profile allowed to call Rekognition:
 * AWS_PROFILE=sowaka-deploy npx tsx <repo>/backend/src/scripts/face-id-e2e.ts <enrol.jpg> <same-person.jpg> <other-person.jpg>
 */
import { readFileSync } from 'node:fs';
import { DeleteCollectionCommand, RekognitionClient } from '@aws-sdk/client-rekognition';
import sharp from 'sharp';
import { env } from '../config/env';
import { enrolmentProblem, verifyProblem } from '../services/face-id.service';
import { createRekognitionEngine } from '../services/rekognition.service';

const COLLECTION = 'sowaka-test-faces';
const REGION = 'ap-south-1';

let failed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got === undefined ? '' : `  (${JSON.stringify(got)})`}`);
  if (!ok) failed += 1;
}

/** As the server prepares a photo: upright, at most 1280 px, JPEG. */
const prepare = (path: string) =>
  sharp(readFileSync(path)).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();

async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const result = await run();
  console.log(`     ${label}: ${Date.now() - started} ms`);
  return result;
}

(async () => {
  const [enrolPath, samePath, otherPath] = process.argv.slice(2);
  if (!enrolPath || !samePath || !otherPath) throw new Error('usage: face-id-e2e.ts <enrol.jpg> <same-person.jpg> <other-person.jpg>');
  if (process.env.AWS_ACCESS_KEY_ID) throw new Error('AWS_ACCESS_KEY_ID is set: run outside backend/ with AWS_PROFILE instead');
  const engine = createRekognitionEngine({ defaultCredentials: true, region: REGION });
  const [enrolPhoto, samePhoto, otherPhoto] = await Promise.all([prepare(enrolPath), prepare(samePath), prepare(otherPath)]);
  try {
    await timed('ensure collection', () => engine.ensureCollection(COLLECTION));
    const faces = await timed('DetectFaces (enrolment gate)', () => engine.detectFaces(enrolPhoto));
    check('the enrolment photo passes the quality gate', enrolmentProblem(faces) === null, { problem: enrolmentProblem(faces), faces: faces.length, brightness: faces[0]?.brightness, sharpness: faces[0]?.sharpness, yaw: faces[0]?.yaw });
    const indexed = await timed('IndexFaces', () => engine.indexFace(COLLECTION, enrolPhoto, 'person-a'));
    check('the face is indexed', Boolean(indexed?.faceId));

    const same = await timed('SearchFacesByImage (same person)', () => engine.searchFace(COLLECTION, samePhoto, 80));
    const top = same?.[0];
    check(`the same person matches at ${env.face.matchThreshold} or above`,
      top?.faceId === indexed?.faceId && top?.externalImageId === 'person-a' && (top?.similarity ?? 0) >= env.face.matchThreshold,
      same?.map((match) => ({ id: match.externalImageId, similarity: Number(match.similarity.toFixed(3)) })));

    const other = await timed('SearchFacesByImage (other person)', () => engine.searchFace(COLLECTION, otherPhoto, 0));
    const best = other?.[0]?.similarity ?? 0;
    check(`a different person does not reach ${env.face.matchThreshold}`, best < env.face.matchThreshold, { bestSimilarity: Number(best.toFixed(3)) });
    const otherFaces = await timed('DetectFaces (diagnosis)', () => engine.detectFaces(otherPhoto));
    check('a clear photo of someone else reads as not a match, not a photo problem', verifyProblem(otherFaces) === null, verifyProblem(otherFaces));

    const blank = await sharp({ create: { width: 640, height: 640, channels: 3, background: '#808080' } }).jpeg().toBuffer();
    const noFace = await timed('SearchFacesByImage (no face)', () => engine.searchFace(COLLECTION, blank, 80));
    check('a photo with no face is told apart from a mismatch', noFace === null, noFace);
  } finally {
    await new RekognitionClient({ region: REGION })
      .send(new DeleteCollectionCommand({ CollectionId: COLLECTION }))
      .then(() => console.log(`     deleted collection ${COLLECTION}`))
      .catch((error) => { console.error(`could not delete ${COLLECTION}: delete it by hand`, error); failed += 1; });
  }
  console.log(failed === 0 ? '\nall face-id e2e checks passed' : `\n${failed} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
