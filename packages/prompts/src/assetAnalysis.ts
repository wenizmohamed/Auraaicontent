export function buildAssetAnalysisPrompt(mimeType: string): string {
  return `Analyze this ${mimeType} asset for a social media content team. Return JSON.`;
}
