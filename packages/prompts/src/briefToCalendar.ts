// Prompt template for generating a full month calendar from client brief
// This will be called by server worker, NOT the frontend

export function buildPlanningPrompt(params: {
  brief: any;
  assets: any[];
  retrieved: any[];
  month: string;
  pieceCount: number;
}): string {
  // Placeholder — will be populated from existing src/lib/prompts.ts during Commit 10
  return `Generate ${params.pieceCount} content pieces for ${params.month}`;
}
