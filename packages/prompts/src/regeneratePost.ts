export function buildRegeneratePostPrompt(post: any, instructions: string): string {
  return `Regenerate this post with instructions: ${instructions}`;
}
