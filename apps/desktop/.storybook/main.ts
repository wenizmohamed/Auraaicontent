import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx|mdx)'],
  addons: ['@storybook/addon-essentials', '@storybook/addon-a11y'],
  framework: { name: '@storybook/react-vite', options: {} },
  docs: { autodocs: 'tag' },
  // Tailwind v4 picks up @import "tailwindcss" from the entry CSS
  // automatically — no PostCSS plugin needed in the SB Vite config.
};

export default config;
