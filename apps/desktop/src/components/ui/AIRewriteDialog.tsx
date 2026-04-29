/**
 * AIRewriteDialog — wraps DiffView in a Dialog for accept/reject flows.
 * Used by inline AI rewrites in BriefInput, ContentReview, etc.
 *
 * Usage:
 *   const rewrite = useAIRewrite();
 *   ...
 *   <InlineAITextHost onAction={(act, sel) => rewrite.start(act, sel, applyText)}>
 *     <textarea ... />
 *   </InlineAITextHost>
 *   <AIRewriteDialog state={rewrite.state} onClose={rewrite.cancel} />
 */
import { useState, useCallback } from 'react';
import { Dialog } from './Dialog';
import { DiffView } from './DiffView';
import { Button } from './Button';
import { assistantApi } from '../../lib/backend-api';

export type RewriteState =
  | { phase: 'idle' }
  | { phase: 'loading'; before: string; action: string }
  | { phase: 'ready';   before: string; after: string; action: string; apply: (newText: string) => void }
  | { phase: 'error';   message: string };

interface AIRewriteDialogProps {
  state: RewriteState;
  onClose: () => void;
}

export function AIRewriteDialog({ state, onClose }: AIRewriteDialogProps) {
  const open = state.phase !== 'idle';
  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Content
        title={
          state.phase === 'loading' ? 'Generating…'
          : state.phase === 'ready' ? `AI ${state.action}`
          : state.phase === 'error' ? 'Rewrite failed'
          : ''
        }
        description={state.phase === 'ready' ? 'Review the diff. Accept replaces the selection, reject discards.' : undefined}
        width={620}
      >
        {state.phase === 'loading' && (
          <p className="ai-streaming text-[14px] font-medium">Streaming response…</p>
        )}
        {state.phase === 'error' && (
          <p className="text-[13px]" style={{ color: 'var(--color-danger)' }}>{state.message}</p>
        )}
        {state.phase === 'ready' && (
          <DiffView
            before={state.before}
            after={state.after}
            onAccept={() => { state.apply(state.after); onClose(); }}
            onReject={onClose}
          />
        )}
        {state.phase === 'error' && (
          <Dialog.Footer>
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </Dialog.Footer>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

const ACTION_PROMPTS: Record<string, (text: string) => string> = {
  rewrite:    (t) => `Rewrite this text to be clearer and more polished. Return only the rewritten version, no preamble:\n\n${t}`,
  shorten:    (t) => `Shorten this text by ~30% without losing meaning. Return only the result:\n\n${t}`,
  translate:  (t) => `Translate this text to ${/^[؀-ۿ]/.test(t) ? 'English' : 'Arabic (Khaleeji dialect)'}. Return only the translation:\n\n${t}`,
  'on-brand': (t) => `Rewrite this so it matches a confident, editorial-tone Gulf-region marketing voice. Return only the result:\n\n${t}`,
};

/** Hook that drives the rewrite state machine. */
export function useAIRewrite() {
  const [state, setState] = useState<RewriteState>({ phase: 'idle' });

  const start = useCallback(async (
    action: string,
    selectedText: string,
    apply: (newText: string) => void,
  ) => {
    const prompt = ACTION_PROMPTS[action]?.(selectedText) ?? `${action}: ${selectedText}`;
    setState({ phase: 'loading', before: selectedText, action });
    try {
      const res = await assistantApi.chat([{ role: 'user', content: prompt }]);
      const after = (res.message?.content ?? '').trim();
      if (!after) throw new Error('Empty AI response');
      setState({ phase: 'ready', before: selectedText, after, action, apply });
    } catch (err: any) {
      setState({ phase: 'error', message: err?.message ?? 'unknown' });
    }
  }, []);

  const cancel = useCallback(() => setState({ phase: 'idle' }), []);

  return { state, start, cancel };
}
