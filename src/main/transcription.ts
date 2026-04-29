import { env, pipeline } from '@huggingface/transformers';

import type { AppSettings } from '../shared/types';
import type { StoragePaths } from './storage';

type Transcriber = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<{ text?: string }>;

const MIN_SPEECH_DURATION_SECONDS = 0.45;
const SILENCE_RMS_THRESHOLD = 0.0035;
const SILENCE_PEAK_THRESHOLD = 0.035;

let transcriberKey: string | null = null;
let transcriberPromise: Promise<Transcriber> | null = null;

function configureTransformers(paths: StoragePaths): void {
  env.allowRemoteModels = true;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.cacheDir = paths.models;
  env.localModelPath = paths.models;
}

export async function prepareTranscriber(
  settings: AppSettings,
  paths: StoragePaths,
): Promise<void> {
  await getTranscriber(settings, paths);
}

async function getTranscriber(settings: AppSettings, paths: StoragePaths): Promise<Transcriber> {
  configureTransformers(paths);

  const key = `${settings.whisperModel}:${paths.models}`;
  if (transcriberPromise && transcriberKey === key) {
    return transcriberPromise;
  }

  transcriberKey = key;
  transcriberPromise = pipeline('automatic-speech-recognition', settings.whisperModel, {
    quantized: true,
  } as Record<string, unknown>) as unknown as Promise<Transcriber>;

  return transcriberPromise;
}

function decodePcm16Wave(buffer: Buffer): Float32Array {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const readTag = (offset: number) =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );

  if (readTag(0) !== 'RIFF' || readTag(8) !== 'WAVE') {
    throw new Error('OpenWhisp received an invalid WAV recording.');
  }

  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset < view.byteLength) {
    const chunkId = readTag(offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkId === 'fmt ') {
      audioFormat = view.getUint16(chunkDataOffset, true);
      channels = view.getUint16(chunkDataOffset + 2, true);
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
    }

    if (chunkId === 'data') {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16 || dataOffset === 0) {
    throw new Error('OpenWhisp expected a mono 16-bit PCM WAV recording.');
  }

  const sampleCount = dataSize / 2;
  const audio = new Float32Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    const value = view.getInt16(dataOffset + index * 2, true);
    audio[index] = Math.max(-1, value / 0x8000);
  }

  return audio;
}

function hasEnoughAudioEnergy(audio: Float32Array, sampleRate: number): boolean {
  if (audio.length / sampleRate < MIN_SPEECH_DURATION_SECONDS) {
    return false;
  }

  let sumSquares = 0;
  let peak = 0;
  for (const sample of audio) {
    const abs = Math.abs(sample);
    sumSquares += sample * sample;
    if (abs > peak) peak = abs;
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, audio.length));
  return rms >= SILENCE_RMS_THRESHOLD || peak >= SILENCE_PEAK_THRESHOLD;
}

export async function transcribeRecording(
  wavBase64: string,
  settings: AppSettings,
  paths: StoragePaths,
): Promise<string> {
  const transcriber = await getTranscriber(settings, paths);
  const audio = decodePcm16Wave(Buffer.from(wavBase64, 'base64'));
  if (!hasEnoughAudioEnergy(audio, 16_000)) {
    return '';
  }

  const result = await transcriber(audio, {
    return_timestamps: false,
    chunk_length_s: 20,
    stride_length_s: 4,
    sampling_rate: 16_000,
  });

  return result.text?.trim() ?? '';
}
