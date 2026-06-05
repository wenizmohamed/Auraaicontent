/**
 * Design system barrel — single import point for all primitives.
 *
 * Pattern (going forward):
 *   import { Button, Dialog, EmptyState, cn } from '@/components/ui';
 *
 * Discipline: every primitive lives in its own file. This barrel only
 * re-exports. Don't add component bodies here.
 *
 * Legacy 8 widgets (Card, the old EmptyState/LoadingSkeleton/etc.) live
 * in legacy.tsx — kept around for archive only; nothing imports from
 * there. Will be deleted after the page sweep is complete.
 */

export { cn } from './cn';

export { Avatar } from './Avatar';
export { Badge } from './Badge';
export { Breadcrumb } from './Breadcrumb';
export { BulkActionBar } from './BulkActionBar';
export { Button, buttonVariants } from './Button';
export { Checkbox } from './Checkbox';
export { Dialog } from './Dialog';
export { DiffView } from './DiffView';
export { AIRewriteDialog, useAIRewrite, type RewriteState } from './AIRewriteDialog';
export { Drawer } from './Drawer';
export { EmptyState, EmptyStateAction } from './EmptyState';
export { HoverCard } from './HoverCard';
export { Image } from './Image';
export { InlineAITextHost, type InlineAIAction } from './InlineAITextToolbar';
export { NudgeBanner } from './NudgeBanner';
export { Progress } from './Progress';
export { RadioGroup } from './RadioGroup';
export { ScrollArea } from './ScrollArea';
export { Select } from './Select';
export { Separator } from './Separator';
export {
  Skeleton,
  SkeletonText,
  SkeletonCard,
  SkeletonAvatar,
  SkeletonRow,
  SkeletonCalendarGrid,
  SkeletonAnnouncer,
} from './Skeleton';
export { SlashMenu, useSlashTrigger, DEFAULT_SLASH_ACTIONS, type SlashAction } from './SlashMenu';
export { Slider } from './Slider';
export { Sparkline } from './Sparkline';
export { MaskedGridIcon } from './MaskedGridIcon';
export { FeatureCard } from './FeatureCard';
export { BentoGrid, BentoTile } from './BentoGrid';
export { AnimatedGradientBorder } from './AnimatedGradientBorder';
export { Switch } from './Switch';
export { Tabs } from './Tabs';
export { Toggle } from './Toggle';
export { Tooltip, TooltipProvider } from './Tooltip';
