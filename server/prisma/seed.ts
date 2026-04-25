import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();

async function upsertUser(email: string, name: string, role: string, passwordPlain: string) {
  const passwordHash = await bcrypt.hash(passwordPlain, 12);
  return db.user.upsert({
    where: { email },
    update: { name, role },
    create: { email, name, role, passwordHash },
  });
}

async function upsertClient(slug: string, data: {
  name: string;
  industry?: string;
  website?: string;
  instagramHandle?: string;
  primaryColor?: string;
}) {
  return db.client.upsert({
    where: { slug },
    update: data,
    create: { slug, status: 'active', ...data },
  });
}

async function main() {
  console.log('[seed] starting…');

  // Demo users
  const admin = await upsertUser('demo-admin@radix.local', 'Demo Admin', 'admin', 'demoAdmin2026!');
  const member = await upsertUser('demo-member@radix.local', 'Demo Member', 'member', 'demoMember2026!');
  console.log(`[seed] users: ${admin.email}, ${member.email}`);

  // Al Fardan demo client
  const alFardan = await upsertClient('al-fardan-exchange', {
    name: 'Al Fardan Exchange',
    industry: 'Financial Services',
    website: 'https://alfardanexchange.com',
    instagramHandle: '@alfardanexchange',
    primaryColor: '#0e7490',
  });

  // Brief — uses ClientBrief schema (objective/audience/tone/brandDo/brandDont
  // /products/pillars/campaignMoments/channels/approvers + optional fields)
  await db.clientBrief.upsert({
    where: { clientId: alFardan.id },
    update: {},
    create: {
      clientId: alFardan.id,
      objective: 'Drive remittance app downloads + UAE-resident trust during Ramadan / Eid 2026.',
      audience: 'UAE residents (expats + locals), South Asian migrant workers, business travellers, SME owners.',
      tone: 'Confident, trustworthy, regulator-friendly. Avoids slang. Bilingual EN/AR.',
      brandDo: 'Cite license number, show real branches, real customer faces, end with clear CTA.',
      brandDont: 'No specific FX rates in evergreen content (compliance risk). No competitor names. No religious humor.',
      products: ['Remittance', 'Currency exchange', 'Al Fardan Mobile App', 'Business FX'] as any,
      pillars: ['Trust & compliance', 'Speed & convenience', 'Cultural relevance (Ramadan, National Day)', 'Financial literacy'] as any,
      campaignMoments: ['Ramadan kickoff', 'Eid Al Fitr', 'UAE National Day', 'New app launch'] as any,
      mandatoryInclusions: 'Al Fardan license number, app-store badges (iOS + Android), bilingual subtitle for reels.',
      complianceNotes: 'No specific FX rates in evergreen content (Central Bank). All testimonials need signed release.',
      channels: ['Instagram', 'TikTok', 'LinkedIn', 'YouTube Shorts'] as any,
      cadence: '4 reels + 2 carousels + 4 stories per week',
      references: 'See Wise.com social, Revolut UK ramadan campaign 2025.',
      approvers: [{ name: 'Brand Lead', email: 'brand@alfardanexchange.com' }, { name: 'Compliance', email: 'compliance@alfardanexchange.com' }] as any,
      seasonalNotes: 'Ramadan March 2026 — focus on family-reunion remittance angles.',
      competitors: 'Wise, LuLu Money, Western Union UAE, Now Money',
      successDefinition: '15% MoM app-download lift + 20%+ engagement rate on Ramadan reels.',
      pastLearnings: 'BTS-branch reels outperform polished studio shoots 3.2× on engagement (Q4 2025 report).',
    },
  });

  // 1 demo calendar month
  const month = await db.calendarMonth.upsert({
    where: { clientId_month: { clientId: alFardan.id, month: 'May 2026' } },
    update: {},
    create: {
      clientId: alFardan.id,
      month: 'May 2026',
      status: 'draft',
      isArchived: false,
    },
  });

  // 5 demo posts (uses CalendarPost schema fields, not the legacy day/type/station)
  const posts = [
    { date: '2026-05-01', title: 'Eid Remittance Hero', pillar: 'Speed & convenience', platform: 'Instagram', format: 'Reel', caption: 'Send money home for Eid in 30 seconds.', status: 'draft' },
    { date: '2026-05-05', title: 'New App Walkthrough', pillar: 'Trust & compliance', platform: 'Instagram', format: 'Carousel', caption: 'How to use the new Al Fardan app — step by step.', status: 'draft' },
    { date: '2026-05-12', title: 'Sharjah Branch BTS', pillar: 'Cultural relevance', platform: 'Instagram', format: 'Story', caption: 'Behind the scenes at our Sharjah branch.', status: 'draft' },
    { date: '2026-05-18', title: 'FX Rate Spotlight', pillar: 'Financial literacy', platform: 'Instagram', format: 'Post', caption: 'Best rates for INR, PHP, EGP this week.', status: 'draft' },
    { date: '2026-05-25', title: 'Trust Reel', pillar: 'Trust & compliance', platform: 'Instagram', format: 'Reel', caption: 'Why 4M+ UAE residents trust Al Fardan.', status: 'draft' },
  ];
  for (const p of posts) {
    await db.calendarPost.upsert({
      where: { calendarMonthId_date: { calendarMonthId: month.id, date: p.date } },
      update: {},
      create: { ...p, calendarMonthId: month.id },
    });
  }

  console.log(`[seed] clients: ${alFardan.slug} (1 month, ${posts.length} posts)`);
  console.log('[seed] done.');
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
