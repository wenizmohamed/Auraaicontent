import type { Meta, StoryObj } from '@storybook/react';
import { Plus, Trash2, Sparkles } from 'lucide-react';
import { Button } from './Button';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'ghost', 'danger', 'link'] },
    size:    { control: 'select', options: ['sm', 'md', 'lg'] },
    block:   { control: 'boolean' },
    loading: { control: 'boolean' },
  },
  args: { variant: 'primary', size: 'md', children: 'Save' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary:   Story = { args: { variant: 'primary',   children: 'Save' } };
export const Secondary: Story = { args: { variant: 'secondary', children: 'Cancel' } };
export const Ghost:     Story = { args: { variant: 'ghost',     children: 'Skip' } };
export const Danger:    Story = { args: { variant: 'danger',    children: 'Delete', leftIcon: <Trash2 size={14} /> } };
export const WithIcons: Story = {
  args: { variant: 'primary', children: 'Generate', leftIcon: <Sparkles size={14} /> },
};
export const Loading:   Story = { args: { variant: 'primary', loading: true, children: 'Saving…' } };
export const Block:     Story = { args: { variant: 'primary', block: true, children: 'Full width', leftIcon: <Plus size={14} /> } };
export const Sizes:     Story = {
  render: (args) => (
    <div className="flex items-end gap-3">
      <Button {...args} size="sm">Small</Button>
      <Button {...args} size="md">Medium</Button>
      <Button {...args} size="lg">Large</Button>
    </div>
  ),
};
