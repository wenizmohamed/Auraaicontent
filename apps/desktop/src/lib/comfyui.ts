// ComfyUI API Client — Local (localhost:8188) + Cloud (cloud.comfy.org)
// Uses your 5K ComfyUI credits for cloud, or free local GPU inference

// Use Vite proxy to avoid CORS (browser can't fetch localhost directly)
const LOCAL_URL = '/comfyui-api';
const CLOUD_URL = 'https://cloud.comfy.org';
const CLOUD_KEY = process.env.COMFYUI_CLOUD_API_KEY || '';

export type ComfyMode = 'local' | 'cloud';

// ─── Check if local ComfyUI is running (cached for 30s) ─────────

let _comfyCache: { ok: boolean; ts: number } | null = null;
const COMFY_CACHE_MS = 30_000;

export async function isComfyUIRunning(): Promise<boolean> {
  if (_comfyCache && Date.now() - _comfyCache.ts < COMFY_CACHE_MS) return _comfyCache.ok;
  try {
    const res = await fetch(`${LOCAL_URL}/system_stats`, { signal: AbortSignal.timeout(2000) });
    _comfyCache = { ok: res.ok, ts: Date.now() };
    return res.ok;
  } catch {
    _comfyCache = { ok: false, ts: Date.now() };
    return false;
  }
}

// ─── Get available models from local ComfyUI ────────────────────

export async function getLocalModels(): Promise<string[]> {
  try {
    const res = await fetch(`${LOCAL_URL}/object_info`);
    const data = await res.json();
    // Extract checkpoint model names
    const loaders = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
    return loaders;
  } catch {
    return [];
  }
}

// ─── Text-to-Image Workflow (SDXL / Flux) ────────────────────────

export function buildTxt2ImgWorkflow(params: {
  prompt: string;
  negativePrompt?: string;
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
}): Record<string, any> {
  const {
    prompt,
    negativePrompt = 'ugly, blurry, low quality, deformed, watermark, text',
    model = 'epicrealismXL_v10.safetensors',
    width = 1024,
    height = 1024,
    steps = 25,
    seed = Math.floor(Math.random() * 2147483647),
  } = params;

  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: model },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt, clip: ['1', 1] },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negativePrompt, clip: ['1', 1] },
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
        seed,
        steps,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
      },
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
    },
    '7': {
      class_type: 'SaveImage',
      inputs: { images: ['6', 0], filename_prefix: 'radix' },
    },
  };
}

// ─── Submit workflow to ComfyUI ──────────────────────────────────

export async function submitWorkflow(
  workflow: Record<string, any>,
  mode: ComfyMode = 'local'
): Promise<string> {
  const url = mode === 'cloud' ? CLOUD_URL : LOCAL_URL;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (mode === 'cloud' && CLOUD_KEY) {
    headers['X-API-Key'] = CLOUD_KEY;
  }

  const clientId = crypto.randomUUID();
  const res = await fetch(`${url}/prompt`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`ComfyUI error: ${JSON.stringify(err).slice(0, 200)}`);
  }

  const data = await res.json();
  return data.prompt_id;
}

// ─── Poll for completion and get images ──────────────────────────

export async function waitForResult(
  promptId: string,
  mode: ComfyMode = 'local',
  maxWaitMs = 120000
): Promise<string[]> {
  const url = mode === 'cloud' ? CLOUD_URL : LOCAL_URL;
  const headers: Record<string, string> = {};
  if (mode === 'cloud' && CLOUD_KEY) headers['X-API-Key'] = CLOUD_KEY;

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${url}/history/${promptId}`, { headers });
      const data = await res.json();

      if (data[promptId]?.outputs) {
        const outputs = data[promptId].outputs;
        const images: string[] = [];

        for (const nodeId of Object.keys(outputs)) {
          const nodeOutput = outputs[nodeId];
          if (nodeOutput.images) {
            for (const img of nodeOutput.images) {
              // Fetch the actual image
              const imgUrl = `${url}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${img.type || 'output'}`;
              const imgRes = await fetch(imgUrl, { headers });
              const blob = await imgRes.blob();
              const base64 = await blobToBase64(blob);
              images.push(base64);
            }
          }
        }

        if (images.length > 0) return images;
      }
    } catch {}

    await new Promise(r => setTimeout(r, 2000));
  }

  throw new Error('ComfyUI generation timed out');
}

// ─── Full generate function ──────────────────────────────────────

export async function generateWithComfyUI(params: {
  prompt: string;
  negativePrompt?: string;
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  mode?: ComfyMode;
}): Promise<string> {
  const mode = params.mode || (await isComfyUIRunning() ? 'local' : 'cloud');
  const workflow = buildTxt2ImgWorkflow(params);
  const promptId = await submitWorkflow(workflow, mode);
  const images = await waitForResult(promptId, mode);
  return images[0]; // Return first image as base64
}

// ─── Helper ──────────────────────────────────────────────────────

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || result);
    };
    reader.readAsDataURL(blob);
  });
}
