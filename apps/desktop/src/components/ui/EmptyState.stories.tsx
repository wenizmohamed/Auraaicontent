import type { Meta, StoryObj } from '@storybook/react';
import { Building2, Database, Sparkles, Plus, Upload } from 'lucide-react';
import { EmptyState, EmptyStateAction } from './EmptyState';

const meta = {
  title: 'Primitives/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoClients: Story = {
  args: {
    icon: Building2,
    title: 'No clients yet',
    description: 'Add a brand to start generating calendars, briefs, and visual assets.',
    primary: <EmptyStateAction><Plus className="w-4 h-4" /> Create your first client</EmptyStateAction>,
  },
};

export const NoKnowledge: Story = {
  args: {
    icon: Database,
    title: 'No knowledge items yet',
    description: 'Upload briefs, brand guides, references — anything the AI should know about. Documents are auto-embedded for retrieval-augmented generation.',
    primary: <EmptyStateAction><Upload className="w-4 h-4" /> Upload first document</EmptyStateAction>,
  },
};

export const Compact: Story = {
  args: {
    icon: Sparkles,
    title: 'Pick a content piece',
    description: 'Select a row on the left to preview, edit, or generate variants.',
    compact: true,
  },
};
