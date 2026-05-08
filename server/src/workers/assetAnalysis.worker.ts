import fs from 'fs';
import { aiRouter } from '../services/providers/ai-router.js';
import { assetService } from '../services/asset.service.js';
import { storageService } from '../services/storage.service.js';

export async function analyzeAssetWorker(orgId: string, assetId: string, userId?: string): Promise<any> {
  const asset = await assetService.getById(orgId, assetId);
  if (!asset) throw new Error('Asset not found');
  if (!asset.mimeType.startsWith('image/')) throw new Error('Only image assets can be analyzed');

  const absPath = storageService.getAbsolutePath(asset.fileUrl);
  if (!fs.existsSync(absPath)) throw new Error('Asset file not found on disk');

  const buffer = fs.readFileSync(absPath);
  const base64 = buffer.toString('base64');

  const result = await aiRouter.analysis(
    {
      prompt: `Analyze this image for a social media content planning tool. Return JSON with:
- description: what the image shows
- tags: array of relevant tags
- suggestedPlatforms: which social platforms this would work best on
- mood: the visual mood/tone
- colors: dominant colors
- safeForClient: boolean, is this appropriate for professional client content`,
      imageBase64: base64,
      mimeType: asset.mimeType,
    },
    { orgId, userId, clientId: asset.clientId ?? undefined },
  );

  const analysis = result.output as any;
  await assetService.update(orgId, assetId, { analysis, tags: analysis.tags || [] });

  console.log(`[assetAnalysis] ${assetId}: analyzed via ${result.provider}/${result.model} (${result.latencyMs}ms)`);
  return analysis;
}
