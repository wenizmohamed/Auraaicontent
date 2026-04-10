import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { promises as fsp } from 'fs';
import type { AiProvider, AnalysisRequest, ImageRequest, ProviderResult, TextRequest, VideoRequest } from './types.js';
import { AiProviderError } from './errors.js';
import { storageService } from '../storage.service.js';

const TIMEOUT = parseInt(process.env.GEMINI_TIMEOUT_MS || '180000', 10);

function getAI(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiProviderError('gemini', 'init', 'GEMINI_API_KEY not set', 401);
  return new GoogleGenAI({ apiKey: key });
}

function safeJsonParse(text: string, label: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/[\[{][\s\S]*[\]}]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    throw new AiProviderError('gemini', label, `JSON parse failed. Response: ${text.slice(0, 200)}`);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AiProviderError('gemini', label, `timeout after ${ms}ms`)), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }).catch(e => { clearTimeout(timer); reject(e); });
  });
}

export const geminiProvider: AiProvider = {
  name: 'gemini',

  async text(req: TextRequest): Promise<ProviderResult<string | object>> {
    const ai = getAI();
    const model = process.env.GEMINI_TEXT_MODEL || 'gemini-3.1-pro-preview';
    const start = Date.now();
    const response = await withTimeout(
      ai.models.generateContent({
        model,
        contents: req.system ? `${req.system}\n\n${req.prompt}` : req.prompt,
        config: req.json ? { responseMimeType: 'application/json' } : undefined,
      }),
      TIMEOUT, 'text',
    );
    const text = response.text ?? '';
    return {
      provider: 'gemini', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: req.json ? safeJsonParse(text, 'text') : text,
    };
  },

  async image(req: ImageRequest): Promise<ProviderResult<{ url?: string; base64?: string }>> {
    const ai = getAI();
    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview';
    const start = Date.now();
    const response = await withTimeout(
      ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: req.prompt }] }],
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          ...(req.aspectRatio ? { imageConfig: { aspectRatio: req.aspectRatio } } : {}),
        },
      }),
      TIMEOUT, 'image',
    );
    const part = (response as any).candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    return {
      provider: 'gemini', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: { base64: part?.inlineData?.data },
    };
  },

  async imageEdit(req: ImageRequest): Promise<ProviderResult<{ url?: string; base64?: string }>> {
    const ai = getAI();
    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview';
    const start = Date.now();
    const parts: any[] = [];
    if (req.imageBase64 && req.mimeType) {
      parts.push({ inlineData: { mimeType: req.mimeType, data: req.imageBase64 } });
    }
    for (const ref of req.referenceImages || []) {
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.base64 } });
    }
    parts.push({ text: req.prompt });
    const response = await withTimeout(
      ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          ...(req.aspectRatio ? { imageConfig: { aspectRatio: req.aspectRatio } } : {}),
        },
      }),
      TIMEOUT, 'imageEdit',
    );
    const part = (response as any).candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    return {
      provider: 'gemini', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: { base64: part?.inlineData?.data },
    };
  },

  async video(req: VideoRequest): Promise<ProviderResult<{ url: string }>> {
    const ai = getAI();
    const model = process.env.GEMINI_VIDEO_MODEL || 'veo-3.1-generate-preview';
    const start = Date.now();
    let operation = await ai.models.generateVideos({
      model,
      prompt: req.prompt,
      config: {
        aspectRatio: req.aspectRatio || '16:9',
        ...(req.resolution ? { resolution: req.resolution } : {}),
      },
      ...(req.imageBase64 && req.mimeType ? {
        image: { imageBytes: req.imageBase64, mimeType: req.mimeType },
      } : {}),
    });
    while (!operation.done) {
      await new Promise(r => setTimeout(r, 10000));
      operation = await ai.operations.getVideosOperation({ operation });
    }
    const file = (operation as any).response?.generatedVideos?.[0]?.video;
    if (!file?.uri) throw new AiProviderError('gemini', 'video', 'No video URI in response');

    // Gemini Veo returns a temporary, auth-required URL like
    //   https://generativelanguage.googleapis.com/v1beta/files/<id>:download?alt=media
    // The browser cannot load that directly (401/empty), and the URL expires
    // shortly after the operation completes. Download it via the SDK NOW (with
    // the API key embedded in the client) and persist via storageService so the
    // frontend gets a stable /uploads/... URL it can render with <video src>.
    const filename = `veo-${Date.now()}.mp4`;
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    await fsp.mkdir(uploadsDir, { recursive: true });
    const tmpPath = path.join(uploadsDir, `tmp-${filename}`);
    try {
      await ai.files.download({ file, downloadPath: tmpPath });
      const buf = await fsp.readFile(tmpPath);
      const { fileUrl } = await storageService.saveFile(buf, filename, 'video/mp4');
      return {
        provider: 'gemini', model, latencyMs: Date.now() - start, fallbackUsed: false,
        output: { url: fileUrl },
      };
    } finally {
      await fsp.unlink(tmpPath).catch(() => { /* ignore */ });
    }
  },

  async analysis(req: AnalysisRequest): Promise<ProviderResult<object>> {
    const ai = getAI();
    const model = process.env.GEMINI_TEXT_MODEL || 'gemini-3.1-pro-preview';
    const start = Date.now();
    const response = await withTimeout(
      ai.models.generateContent({
        model,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: req.mimeType, data: req.imageBase64 } },
            { text: req.prompt },
          ],
        }],
        config: { responseMimeType: 'application/json' },
      }),
      TIMEOUT, 'analysis',
    );
    return {
      provider: 'gemini', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: safeJsonParse(response.text || '{}', 'analysis'),
    };
  },
};
