// Boot-time registration of every durable job worker. Called once at server
// startup so the BullMQ consumer starts immediately and any jobs still WAITING
// in Redis from a previous process (a deploy/restart landed while they were
// queued) resume right away instead of stranding until the next same-type
// dispatch. Kept separate from queue.ts to avoid an import cycle (workers
// import updateJob from queue.ts; queue.ts imports nothing from here).
import { registerWorkerType } from './queue.js';
import { generateMonthWorker } from './generateMonth.worker.js';
import { exportWorker } from './export.worker.js';
import { publishWorker } from './publish.worker.js';
import { visualRefsBackfillWorker } from './visualRefsBackfill.worker.js';
import { creativeVideoWorker } from './creativeVideo.worker.js';

export function initJobWorkers(): void {
  registerWorkerType('generate-month', generateMonthWorker);
  registerWorkerType('export', exportWorker);
  registerWorkerType('publish', publishWorker);
  registerWorkerType('visual-refs-backfill', visualRefsBackfillWorker);
  registerWorkerType('creative-video', creativeVideoWorker);
  console.log('[queue] job workers registered (generate-month, export, publish, visual-refs-backfill, creative-video)');
}
