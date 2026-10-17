import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readRepoFile = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const readPackage = (path: string) => JSON.parse(readRepoFile(path));

describe('AuraAI branding', () => {
  it('keeps workspace names and lockfile links consistent', () => {
    const root = readPackage('package.json');
    const lock = readPackage('package-lock.json');
    expect(root.name).toBe('aura-ai-content-planner');
    expect(lock.name).toBe(root.name);
    expect(lock.packages[''].name).toBe(root.name);
    expect(Object.values(root.scripts).join('\n')).not.toContain('@radix/');

    for (const path of ['apps/desktop', 'apps/preview-web', 'server', 'packages/prompts', 'packages/shared']) {
      const pkg = readPackage(`${path}/package.json`);
      expect(pkg.name).toMatch(/^@aura\//);
      expect(lock.packages[path].name).toBe(pkg.name);
      expect(lock.packages[`node_modules/${pkg.name}`]).toEqual({ resolved: path, link: true });
    }
  });

  it('brands the desktop release without changing its installed app identity or UI dependencies', () => {
    const desktop = readPackage('apps/desktop/package.json');
    expect(desktop.build.productName).toBe('AuraAI Content Planner V2');
    expect(desktop.build.portable.artifactName).toBe('AuraAI-Content-Planner-Portable-v2.exe');
    expect(desktop.build.appId).toBe('ae.radixmedia.contentplanner');
    expect(desktop.dependencies).toHaveProperty('@radix-ui/react-dialog');
    const electron = readRepoFile('apps/desktop/electron/main.cjs');
    expect(electron).toContain("label: 'Open AuraAI'");
    expect(electron).toContain("tray.setToolTip('AuraAI Content Planner V2')");
  });

  it('uses AuraAI in assistant and review-page copy', () => {
    const assistant = readRepoFile('apps/desktop/src/pages/RadixAssistant.tsx');
    expect(assistant).toContain("I'm AuraAI. Your content strategist.");
    expect(assistant).not.toContain('alt="Radix"');
    expect(readRepoFile('apps/preview-web/index.html')).toContain('<title>AuraAI — Content Review</title>');
    for (const path of ['apps/preview-web/src/main.tsx', 'apps/preview-web/src/pages/Preview.tsx']) {
      const source = readRepoFile(path);
      expect(source).toContain('>AURAAI</h1>');
      expect(source).not.toContain('>RADIX</h1>');
    }
  });

  it('uses Aura in user-facing asset-source labels and sender defaults', () => {
    const search = readRepoFile('server/src/services/visual-search.service.ts');
    expect(search).toContain("sourceDomain: 'aura (approved asset)'");
    expect(search).toContain("sourceDomain: 'aura (past generation)'");
    expect(readRepoFile('server/.env.example')).toContain('EMAIL_FROM=AuraAI <invites@yourdomain.com>');
    expect(readRepoFile('server/src/routes/changelog.ts')).toContain("title: 'Introducing AURAAI Content Planner V2'");
  });
});
