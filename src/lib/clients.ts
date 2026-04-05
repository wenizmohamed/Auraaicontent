// Client Knowledge Base — Pre-loaded with real client data from docs

export interface ClientKB {
  id: string;
  name: string;
  industry: string;
  products: { name: string; description: string; targetAudience: string }[];
  brandGuidelines: string;
  tone: string;
  colors: string[];
  website: string;
  socialHandles: Record<string, string>;
  keyMessages: string[];
  complianceNotes: string;
}

const STORAGE_KEY = 'radix_clients_kb';

// Pre-loaded Al Fardan Exchange data from real docs
export const AL_FARDAN_KB: ClientKB = {
  id: 'al-fardan-exchange',
  name: 'Al Fardan Exchange',
  industry: 'Financial Services / Remittance',
  products: [
    {
      name: 'Money Transfers',
      description: 'Fast, secure international money transfer solutions via 90+ branches and AlfaPay app. Strong network of global partners.',
      targetAudience: 'Blue/White collar workers, expatriates sending money home',
    },
    {
      name: 'Currency Exchange',
      description: 'Competitive exchange rates on all major international currencies through 90+ branches across the UAE.',
      targetAudience: 'Travelers, business professionals, expatriates',
    },
    {
      name: 'Travelez Platinum Card',
      description: 'Multi-currency prepaid travel card supporting 22 currencies. Lock in exchange rates before travel, contactless Visa payments globally.',
      targetAudience: 'Frequent travelers, business travelers, tourists',
    },
    {
      name: 'AlfaPay App',
      description: 'Mobile app for money transfers to 200+ countries, utility/bill payments, real-time exchange rates, in-app chatbot, biometric auth, multilingual (EN/AR).',
      targetAudience: 'White-collar professionals, digitally engaged UAE residents',
    },
    {
      name: 'WPS & Corporate Payroll',
      description: 'Comprehensive WPS and payroll solutions for businesses of all sizes. Employer salary disbursement via WPS cards.',
      targetAudience: 'Businesses, HR departments, employers',
    },
    {
      name: 'Value-Added Services',
      description: 'Utility bill payments, credit card settlements, mobile top-ups, and more.',
      targetAudience: 'General consumers, utility bill payers',
    },
  ],
  brandGuidelines: 'Professional, trustworthy, heritage-driven (since 1971). Emphasis on "Fulfilling Journeys Since 1971" brand campaign. Undergoing rebrand to black & white color scheme.',
  tone: 'Professional, warm, trustworthy, culturally sensitive. Celebrate diversity of UAE expat community.',
  colors: ['#000000', '#FFFFFF', '#C5A55A', '#1A1A2E'],
  website: 'https://alfardanexchange.com',
  socialHandles: {
    instagram: '@alfardanexchange',
    linkedin: 'Al Fardan Exchange',
    facebook: 'Al Fardan Exchange',
    tiktok: '@alfardanexchange',
  },
  keyMessages: [
    'Fulfilling Journeys Since 1971',
    'Better than Google\'s Rate with Free Transfers (AlfaPay)',
    '90+ branches across the UAE',
    'Send money to 200+ countries',
    'Trusted by millions of customers',
    'CBUAE regulated and compliant',
    'Multi-currency Travelez Platinum Card — 22 currencies',
    'Free transfers via net-banking (AlfaPay first-time offer)',
  ],
  complianceNotes: 'All content must comply with CBUAE Consumer Protection Regulations. No misleading claims about rates, fees, or transfer speeds. Disclaimers required for offers. Terms & conditions must be referenced. No guarantees on exchange rates.',
};

// Default campaigns from the real briefing template
export const DEFAULT_CAMPAIGNS = [
  { name: 'Go Global with Al Fardan Exchange', targetAudience: 'Pink/White Collar Workers', productFocus: 'Currency Exchange, Travelez Card', duration: '1 month', objective: 'Product promotion', keyMessage: 'Currency Exchange with attractive rates across our branches. Travelez Platinum Card for seamless travel spending.' },
  { name: 'AlfaPay', targetAudience: 'Pink/White Collar Workers', productFocus: 'AlfaPay App', duration: 'Ongoing', objective: 'Service promotion', keyMessage: 'Promote our app and all services: money transfers, bill payments, real-time rates.' },
  { name: 'Offers by AlfaPay', targetAudience: 'All (Pink/White Collar + WPS customers)', productFocus: 'AlfaPay Offers Feature', duration: 'Ongoing', objective: 'Service promotion', keyMessage: 'Drive subscriptions on Offers by AlfaPay.' },
  { name: 'Brand Campaign — Fulfilling Journeys Since 1971', targetAudience: 'All', productFocus: 'Brand', duration: 'Until Dec 31, 2025', objective: 'Build brand affinity and awareness', keyMessage: 'Focus on fulfilling dreams back home, supporting loved ones.' },
  { name: 'Money Transfers', targetAudience: 'All', productFocus: 'Service', duration: 'Ongoing', objective: 'Service promotion', keyMessage: 'Highlight 50+ years of trusted service, fast and secure transfers.' },
  { name: 'Financial Literacy', targetAudience: 'All', productFocus: 'Thought Leadership', duration: 'Ongoing', objective: 'Engagement', keyMessage: 'TBD — Educational content about financial management.' },
  { name: 'Employer Branding', targetAudience: 'Professional Audiences on LinkedIn', productFocus: 'Brand', duration: 'Ongoing', objective: 'Brand Humanising', keyMessage: 'GPTW Certification, Culture/Life at Al Fardan Exchange.' },
];

// Common special occasions for UAE market
export const DEFAULT_OCCASIONS = [
  { name: 'International Youth Day', date: '12th August' },
  { name: 'Pakistan Independence Day', date: '14th August' },
  { name: 'India Independence Day', date: '15th August' },
  { name: 'Indonesia Independence Day', date: '17th August' },
  { name: 'Emirati Women\'s Day', date: '28th August' },
  { name: 'UAE National Day', date: '2nd December' },
  { name: 'International Workers Day', date: '1st May' },
  { name: 'Ramadan', date: 'Varies' },
  { name: 'Eid Al Fitr', date: 'Varies' },
  { name: 'Eid Al Adha', date: 'Varies' },
];

// Load/save clients to localStorage
export function getClients(): ClientKB[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  // Seed with Al Fardan
  const initial = [AL_FARDAN_KB];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

export function saveClients(clients: ClientKB[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clients));
}

export function getClientById(id: string): ClientKB | undefined {
  return getClients().find(c => c.id === id);
}
