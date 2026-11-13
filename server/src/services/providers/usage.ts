// Token-usage helpers shared by the Google providers (Developer API and Vertex).

/**
 * IMAGE-modality output tokens from a Gemini usageMetadata block, if the
 * response reports them. An image model's output also carries text and
 * thinking tokens, which Google bills at a far lower rate (gemini-3-pro-image:
 * $120 vs $12 per 1M), so the meter needs to know which is which.
 */
export function imageOutputTokensOf(u: any): number | undefined {
  const details = u?.candidatesTokensDetails;
  if (!Array.isArray(details)) return undefined;
  const image = details.filter((d: any) => String(d?.modality).toUpperCase() === 'IMAGE');
  if (!image.length) return undefined;
  return image.reduce((s: number, d: any) => s + (Number(d?.tokenCount) || 0), 0);
}
