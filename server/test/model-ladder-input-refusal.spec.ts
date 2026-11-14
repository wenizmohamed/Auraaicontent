import { describe, it, expect, vi } from 'vitest';
import { runModelLadder } from '../src/services/providers/model-chain';
import { AiProviderError } from '../src/services/providers/errors';

// 2026-11-14 triage: BytePlus refused an input image for privacy and the ladder
// still tried three Seedance models with the same image. An input refusal now
// ends the provider's ladder at once; an output refusal still tries the next.
describe('model ladder and content refusals', () => {
  const ladder = [{ model: 'seedance-a' }, { model: 'seedance-b' }, { model: 'seedance-c' }] as any;

  it('an input refusal stops at the first model', async () => {
    const attempt = vi.fn(async () => {
      throw new AiProviderError('byteplus', 'video', '400 InputImageSensitiveContentDetected.PrivacyInformation', 400);
    });
    await expect(runModelLadder('byteplus', 'video', ladder, attempt)).rejects.toThrow(/InputImageSensitive/);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('an output refusal still tries the next model', async () => {
    let n = 0;
    const attempt = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new AiProviderError('byteplus', 'video', 'safety policy: OutputVideoSensitiveContentDetected', 422);
      return 'ok';
    });
    const r = await runModelLadder('byteplus', 'video', ladder, attempt);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect((r as any).result ?? r).toBeTruthy();
  });
});
