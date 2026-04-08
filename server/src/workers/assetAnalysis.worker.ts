import fs from 'fs';
import { analyzeAsset } from '../services/gemini.service.js';
import { assetService } from '../services/asset.service.js';
import { storageService } from '../services/storage.service.js';

export async function analyzeAssetWorker(assetId: string): Promise<any> {
  const asset = await assetService.getById(assetId);
  if (!asset) throw new Error('Asset not found');
  if (!asset.mimeType.startsWith('image/')) throw new Error('Only image assets can be analyzed');

  const absPath = storageService.getAbsolutePath(asset.fileUrl);
  if (!fs.existsSync(absPath)) throw new Error('Asset file not found on disk');

  const buffer = fs.readFileSync(absPath);
  const base64 = buffer.toString('base64');

  const analysis = await analyzeAsset(base64, asset.mimeType);

  await assetService.update(assetId, { analysis, tags: analysis.tags || [] });
  return analysis;
}
