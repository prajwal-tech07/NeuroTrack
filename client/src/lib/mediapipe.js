/**
 * MediaPipe Tasks Vision loaders.
 *
 * The WASM runtime and the model files are fetched from Google's CDN on first
 * use and then served from the browser cache, so the first assessment on a new
 * machine needs an internet connection; later ones work offline.
 */
const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';

/**
 * The tasks-vision bundle is ~600 kB, and only the assessment flow needs it, so
 * it is imported dynamically rather than shipped in the initial page load.
 */
let visionModulePromise = null;
const getVisionModule = () => {
  if (!visionModulePromise) visionModulePromise = import('@mediapipe/tasks-vision');
  return visionModulePromise;
};

const MODELS = {
  face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  pose: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
};

let filesetPromise = null;
const cache = {};

async function getFileset() {
  if (!filesetPromise) {
    const { FilesetResolver } = await getVisionModule();
    filesetPromise = FilesetResolver.forVisionTasks(WASM_PATH);
  }
  return filesetPromise;
}

export async function loadFaceLandmarker() {
  if (cache.face) return cache.face;
  const [{ FaceLandmarker }, vision] = await Promise.all([getVisionModule(), getFileset()]);
  cache.face = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODELS.face, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
  });
  return cache.face;
}

export async function loadHandLandmarker() {
  if (cache.hand) return cache.hand;
  const [{ HandLandmarker }, vision] = await Promise.all([getVisionModule(), getFileset()]);
  cache.hand = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODELS.hand, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  return cache.hand;
}

export async function loadPoseLandmarker() {
  if (cache.pose) return cache.pose;
  const [{ PoseLandmarker }, vision] = await Promise.all([getVisionModule(), getFileset()]);
  cache.pose = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODELS.pose, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  return cache.pose;
}

/** Frees GPU/WASM resources. Call when leaving the assessment flow. */
export function releaseLandmarkers() {
  for (const key of Object.keys(cache)) {
    try {
      cache[key]?.close?.();
    } catch {
      /* already closed */
    }
    delete cache[key];
  }
}

/** Requests a camera stream sized for landmark tracking. */
export async function startCamera(videoEl, { facingMode = 'user', width = 640, height = 480 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 } },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  return stream;
}

export function stopStream(stream) {
  stream?.getTracks?.().forEach((t) => t.stop());
}

/** Average frame brightness 0..1, used as a lighting-quality signal. */
export function frameBrightness(videoEl, canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = 48;
  const h = 36;
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(videoEl, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / (data.length / 4) / 255;
}
