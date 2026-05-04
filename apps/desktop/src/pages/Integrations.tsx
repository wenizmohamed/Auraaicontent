/**
 * /integrations — top-level page wrapper for IntegrationsPanel.
 *
 * Mounts the same IntegrationsPanel component used at
 * /workspace/settings/integrations, but as a full-width standalone page
 * (no 3-pane workspace shell) so it gets the breathing room a connector
 * grid deserves.
 */
import { motion } from 'framer-motion';
import { motionBase } from '../lib/motion';
import { IntegrationsPanel } from '../components/settings/IntegrationsPanel';

export default function Integrations() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionBase}
      className="mx-auto max-w-[1100px] p-6 lg:p-8"
    >
      <IntegrationsPanel />
    </motion.div>
  );
}
