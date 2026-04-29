import type { Preview } from '@storybook/react';
import '../src/index.css';

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark',   value: '#0a0a0a' },
        { name: 'light',  value: '#f8fafc' },
        { name: 'studio', value: '#000000' },
      ],
    },
    a11y: { test: 'todo' },
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
  },
  globalTypes: {
    theme: {
      description: 'Token-driven theme',
      defaultValue: 'dark',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'dark',   title: 'Dark' },
          { value: 'light',  title: 'Light' },
          { value: 'studio', title: 'Studio' },
        ],
      },
    },
  },
  decorators: [
    (Story, ctx) => {
      // Mirror the theme classes the real app applies on <html>.
      const theme = (ctx.globals as any).theme as 'dark' | 'light' | 'studio';
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('light',  theme === 'light');
        document.documentElement.classList.toggle('dark',   theme === 'dark');
        document.documentElement.classList.toggle('theme-studio', theme === 'studio');
      }
      return <Story />;
    },
  ],
};

export default preview;
