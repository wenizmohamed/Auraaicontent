/**
 * Agent surface — preview of an assistant plan before execution.
 * The visual is real; the data is sample until /api/agent/sessions/:id/plan
 * starts returning structured plan steps.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import AgentPlanView, { type PlanStep } from '../components/agent/AgentPlanView';

const SAMPLE_PLAN: PlanStep[] = [
  {
    id: '1',
    title: 'Read the brief and current calendar',
    description: 'Pull the latest brief, knowledge items, and the current month plan',
    status: 'completed',
    etaSeconds: 8,
    substeps: [
      { id: '1.1', title: 'Fetch brief', status: 'completed', tools: [{ name: 'briefs.get' }] },
      { id: '1.2', title: 'Fetch knowledge', status: 'completed', tools: [{ name: 'knowledge.list' }] },
      { id: '1.3', title: 'Fetch month plan', status: 'completed', tools: [{ name: 'calendar.getMonth', args: { month: 'May 2026' } }] },
    ],
  },
  {
    id: '2',
    title: 'Generate 12 post ideas across pillars',
    description: 'Mix education, social proof, and platform launches by client pillars',
    status: 'in-progress',
    etaSeconds: 35,
    substeps: [
      { id: '2.1', title: 'Cluster pillars', status: 'completed', tools: [{ name: 'pillars.cluster' }] },
      { id: '2.2', title: 'Draft 12 captions', status: 'in-progress', tools: [{ name: 'captions.draft', args: { count: 12 } }] },
      { id: '2.3', title: 'Score for brand voice', status: 'pending', tools: [{ name: 'voice.score' }] },
    ],
  },
  {
    id: '3',
    title: 'Generate visual references for top 6',
    description: 'Image generation pass via the primary visual provider',
    status: 'pending',
    etaSeconds: 90,
    dependencies: ['2'],
    substeps: [
      { id: '3.1', title: 'Pick 6 highest-scoring posts', status: 'pending' },
      { id: '3.2', title: 'Generate images', status: 'pending', tools: [{ name: 'image.generate', args: { count: 6 } }] },
    ],
  },
  {
    id: '4',
    title: 'Schedule into May 2026 calendar',
    description: 'Drop the 12 posts onto recommended dates with platform variants',
    status: 'pending',
    etaSeconds: 12,
    dependencies: ['2', '3'],
    substeps: [
      { id: '4.1', title: 'Compute schedule', status: 'pending' },
      { id: '4.2', title: 'Persist posts', status: 'pending', tools: [{ name: 'calendar.bulkInsert' }] },
    ],
  },
];

export default function Agent() {
  const [running, setRunning] = useState(false);

  return (
    <div className="mx-auto h-full max-w-3xl px-4 py-6">
      <div className="mb-4">
        <h1 className="font-display text-[28px] font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>
          Agent
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--color-fg-muted)' }}>
          Preview the assistant's plan, then approve to run.
        </p>
      </div>
      <div className="h-[calc(100vh-200px)]">
        <AgentPlanView
          plan={SAMPLE_PLAN}
          loading={running}
          onApprove={() => {
            setRunning(true);
            toast.success('Plan approved — execution would start here once /api/agent/sessions/:id/run is wired');
            setTimeout(() => setRunning(false), 1200);
          }}
          onCancel={() => toast('Plan cancelled')}
        />
      </div>
    </div>
  );
}
