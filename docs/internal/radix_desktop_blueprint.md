# RADIX AI Content Planner — Technical Blueprint

## Goal
Build a **desktop-first internal content operations app** with a **secure web preview portal** for clients.

Internal users use the desktop app to:
- create/update client briefs
- upload docs and assets
- generate monthly calendars with Gemini
- edit and review internally
- send preview links
- export PowerPoint/PDF

External clients use only a preview link to:
- view the monthly content plan
- comment per post
- approve/reject posts or the month

---

# 1) System architecture

## High-level

```text
┌──────────────────────────────────────────────────────────────┐
│ Desktop App (Electron + React)                              │
│ Internal team only                                           │
│ - Clients                                                    │
│ - Briefs                                                     │
│ - Knowledge Base                                             │
│ - Assets                                                     │
│ - Generate Month                                             │
│ - Internal Review                                            │
│ - Export                                                     │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTPS / Authenticated API
                ▼
┌──────────────────────────────────────────────────────────────┐
│ Backend API (Node + Fastify/Express)                        │
│ - Auth                                                      │
│ - Client CRUD                                               │
│ - Brief CRUD                                                │
│ - KB ingestion                                              │
│ - Asset upload                                              │
│ - Calendar generation orchestration                         │
│ - Review links                                              │
│ - Comments / approvals                                      │
│ - Export jobs                                               │
│ - Audit logs                                                │
└───────────────┬───────────────────┬──────────────────────────┘
                │                   │
                ▼                   ▼
┌───────────────────────┐   ┌────────────────────────────────┐
│ Postgres              │   │ Object Storage                 │
│ - app data            │   │ - uploaded docs                │
│ - embeddings meta     │   │ - images                       │
│ - comments            │   │ - thumbnails                   │
│ - approvals           │   │ - generated exports            │
└───────────────────────┘   └────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────┐
│ Worker / Job Runner                                          │
│ - Gemini generation                                          │
│ - asset analysis                                             │
│ - embeddings                                                 │
│ - export PPT/PDF                                             │
│ - visual reference search                                    │
│ - video generation                                            │
└───────────────┬──────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────┐
│ External Preview Web App                                     │
│ tokenized review link only                                   │
│ - list/calendar view                                          │
│ - comments                                                    │
│ - approve/reject                                              │
└──────────────────────────────────────────────────────────────┘
```

---

# 2) Recommended stack

## Desktop app
- Electron
- React
- TypeScript
- Vite
- Tailwind
- React Router
- TanStack Query
- Zustand or React context for local UI state

## Backend
- Node.js
- Fastify (preferred) or Express
- Prisma ORM
- PostgreSQL
- Redis + BullMQ for jobs
- JWT auth or session auth

## AI / search / export
- Gemini via `@google/genai`
- pgvector or external vector store
- Sharp for image processing
- PptxGenJS for PowerPoint export
- Playwright or PDF renderer for PDF export

## Storage
- S3-compatible storage / Supabase Storage / Cloudflare R2

## Desktop packaging
- Electron Builder

---

# 3) Product modules

## Internal desktop modules
1. Dashboard
2. Clients
3. Client Brief
4. Knowledge Base
5. Assets
6. Generate Month
7. Review
8. Export
9. Settings

## External web preview modules
1. Preview Home
2. Post Detail / Comments
3. Approval Summary

---

# 4) Repo structure

```text
radix-ai-content-planner/
├─ apps/
│  ├─ desktop/
│  │  ├─ electron/
│  │  │  ├─ main.cjs
│  │  │  └─ preload.cjs
│  │  ├─ src/
│  │  │  ├─ app/
│  │  │  ├─ components/
│  │  │  ├─ pages/
│  │  │  │  ├─ Dashboard.tsx
│  │  │  │  ├─ Clients.tsx
│  │  │  │  ├─ ClientBrief.tsx
│  │  │  │  ├─ KnowledgeBase.tsx
│  │  │  │  ├─ Assets.tsx
│  │  │  │  ├─ GenerateMonth.tsx
│  │  │  │  ├─ Review.tsx
│  │  │  │  ├─ Export.tsx
│  │  │  │  └─ Settings.tsx
│  │  │  ├─ lib/
│  │  │  │  ├─ api.ts
│  │  │  │  ├─ auth.ts
│  │  │  │  ├─ types.ts
│  │  │  │  └─ utils.ts
│  │  │  ├─ hooks/
│  │  │  └─ main.tsx
│  │  ├─ index.html
│  │  └─ vite.config.ts
│  └─ preview-web/
│     ├─ src/
│     │  ├─ pages/
│     │  │  ├─ Preview.tsx
│     │  │  └─ PostReview.tsx
│     │  ├─ lib/api.ts
│     │  └─ main.tsx
│     └─ vite.config.ts
├─ packages/
│  ├─ shared/
│  │  ├─ src/
│  │  │  ├─ types.ts
│  │  │  ├─ schemas.ts
│  │  │  └─ constants.ts
│  └─ prompts/
│     ├─ briefToCalendar.ts
│     ├─ assetAnalysis.ts
│     ├─ regeneratePost.ts
│     └─ referenceSearch.ts
├─ server/
│  ├─ src/
│  │  ├─ index.ts
│  │  ├─ app.ts
│  │  ├─ config/
│  │  ├─ middleware/
│  │  ├─ routes/
│  │  │  ├─ auth.ts
│  │  │  ├─ clients.ts
│  │  │  ├─ briefs.ts
│  │  │  ├─ knowledge.ts
│  │  │  ├─ assets.ts
│  │  │  ├─ calendar.ts
│  │  │  ├─ review.ts
│  │  │  ├─ exports.ts
│  │  │  └─ ai.ts
│  │  ├─ services/
│  │  │  ├─ gemini.service.ts
│  │  │  ├─ brief.service.ts
│  │  │  ├─ asset.service.ts
│  │  │  ├─ retrieval.service.ts
│  │  │  ├─ review.service.ts
│  │  │  ├─ export.service.ts
│  │  │  └─ storage.service.ts
│  │  ├─ workers/
│  │  │  ├─ queue.ts
│  │  │  ├─ generateMonth.worker.ts
│  │  │  ├─ assetAnalysis.worker.ts
│  │  │  ├─ embeddings.worker.ts
│  │  │  ├─ export.worker.ts
│  │  │  └─ video.worker.ts
│  │  └─ db/
│  │     └─ prisma.ts
│  ├─ prisma/
│  │  ├─ schema.prisma
│  │  └─ migrations/
│  └─ package.json
├─ docker-compose.yml
├─ .env.example
└─ package.json
```

---

# 5) Core database schema

## Prisma model sketch

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  role         String   @default("member")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  comments     PostComment[]
  auditLogs    AuditLog[]
}

model Client {
  id              String   @id @default(cuid())
  name            String
  slug            String   @unique
  logoUrl         String?
  primaryColor    String?
  timezone        String?
  industry        String?
  website         String?
  instagramHandle String?
  status          String   @default("active")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  brief           ClientBrief?
  assets          Asset[]
  knowledgeItems  KnowledgeItem[]
  calendarMonths  CalendarMonth[]
  reviewLinks     ReviewLink[]
}

model ClientBrief {
  id                  String   @id @default(cuid())
  clientId            String   @unique
  objective           String
  audience            String
  tone                String
  brandDo             String
  brandDont           String
  products            Json
  pillars             Json
  campaignMoments     Json
  mandatoryInclusions String?
  complianceNotes     String?
  channels            Json
  cadence             String?
  references          String?
  approvers           Json
  seasonalNotes       String?
  competitors         String?
  successDefinition   String?
  pastLearnings       String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  client Client @relation(fields: [clientId], references: [id], onDelete: Cascade)
}

model KnowledgeItem {
  id          String   @id @default(cuid())
  clientId    String
  title       String
  type        String
  fileUrl     String?
  textContent String?
  metadata    Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  client      Client            @relation(fields: [clientId], references: [id], onDelete: Cascade)
  chunks      KnowledgeChunk[]
}

model KnowledgeChunk {
  id              String   @id @default(cuid())
  knowledgeItemId String
  chunkText       String
  embedding       Unsupported("vector")?
  metadata        Json?

  knowledgeItem   KnowledgeItem @relation(fields: [knowledgeItemId], references: [id], onDelete: Cascade)
}

model Asset {
  id             String   @id @default(cuid())
  clientId       String
  name           String
  fileUrl        String
  thumbUrl       String?
  mimeType       String
  width          Int?
  height         Int?
  analysis       Json?
  tags           Json?
  safeForClient  Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  client         Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  linkedPosts    CalendarPostAsset[]
}

model CalendarMonth {
  id          String   @id @default(cuid())
  clientId    String
  month       String
  status      String   @default("draft")
  strategy    Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  client      Client         @relation(fields: [clientId], references: [id], onDelete: Cascade)
  posts       CalendarPost[]
}

model CalendarPost {
  id              String   @id @default(cuid())
  calendarMonthId String
  date            String
  title           String
  pillar          String
  platform        String
  format          String
  hook            String?
  keyMessage      String?
  caption         String
  cta             String?
  hashtags        Json?
  visualDirection String?
  referenceQuery  String?
  rationale       String?
  timing          String?
  status          String   @default("draft")
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  calendarMonth   CalendarMonth       @relation(fields: [calendarMonthId], references: [id], onDelete: Cascade)
  comments        PostComment[]
  versions        PostVersion[]
  assets          CalendarPostAsset[]
}

model CalendarPostAsset {
  postId  String
  assetId String

  post    CalendarPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  asset   Asset        @relation(fields: [assetId], references: [id], onDelete: Cascade)

  @@id([postId, assetId])
}

model PostVersion {
  id        String   @id @default(cuid())
  postId     String
  snapshot   Json
  createdAt  DateTime @default(now())
  createdBy  String?

  post       CalendarPost @relation(fields: [postId], references: [id], onDelete: Cascade)
}

model PostComment {
  id         String   @id @default(cuid())
  postId      String
  authorId    String?
  authorName  String
  source      String   // internal | client
  comment     String
  status      String?  // requested-change | approved | note
  createdAt   DateTime @default(now())

  post        CalendarPost @relation(fields: [postId], references: [id], onDelete: Cascade)
}

model ReviewLink {
  id          String   @id @default(cuid())
  clientId     String
  calendarMonthId String
  token       String   @unique
  expiresAt   DateTime?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())

  client      Client        @relation(fields: [clientId], references: [id], onDelete: Cascade)
}

model ExportJob {
  id          String   @id @default(cuid())
  clientId     String
  calendarMonthId String
  type        String   // pptx | pdf
  status      String   @default("queued")
  fileUrl     String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model AuditLog {
  id         String   @id @default(cuid())
  userId      String?
  clientId    String?
  action      String
  entityType  String
  entityId    String?
  payload     Json?
  createdAt   DateTime @default(now())

  user        User?    @relation(fields: [userId], references: [id])
}
```

---

# 6) Environment variables

```env
# app
NODE_ENV=development
PORT=8080
PREVIEW_WEB_URL=http://localhost:4173
DESKTOP_WEB_URL=http://localhost:3000
JWT_SECRET=change-me

# database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/radix_planner
REDIS_URL=redis://localhost:6379

# storage
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_REGION=

# gemini
GEMINI_API_KEY=
GEMINI_PLANNER_MODEL=gemini-3-flash-preview
GEMINI_STRATEGIST_MODEL=gemini-3.1-pro-preview
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview
GEMINI_VIDEO_MODEL=veo-3.1-generate-preview
GEMINI_VIDEO_FAST_MODEL=veo-3.1-fast-generate-preview
GEMINI_EMBEDDING_MODEL=gemini-embedding-2-preview
```

---

# 7) Backend API blueprint

## Auth
```http
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
```

## Clients
```http
GET    /api/clients
POST   /api/clients
GET    /api/clients/:clientId
PATCH  /api/clients/:clientId
DELETE /api/clients/:clientId
```

## Briefs
```http
GET    /api/clients/:clientId/brief
PUT    /api/clients/:clientId/brief
GET    /api/clients/:clientId/brief/completeness
GET    /api/clients/:clientId/brief/prompt-pack
```

## Knowledge base
```http
GET    /api/clients/:clientId/knowledge
POST   /api/clients/:clientId/knowledge/upload
DELETE /api/knowledge/:knowledgeItemId
POST   /api/knowledge/:knowledgeItemId/embed
```

## Assets
```http
GET    /api/clients/:clientId/assets
POST   /api/clients/:clientId/assets/upload
POST   /api/assets/:assetId/analyze
PATCH  /api/assets/:assetId
DELETE /api/assets/:assetId
```

## Calendar generation
```http
POST   /api/clients/:clientId/calendar/generate
POST   /api/calendar-posts/:postId/regenerate
GET    /api/clients/:clientId/calendar/:month
PATCH  /api/calendar-posts/:postId
POST   /api/calendar-posts/:postId/link-asset
DELETE /api/calendar-posts/:postId/link-asset/:assetId
```

## Review links / comments
```http
POST   /api/clients/:clientId/calendar/:month/review-links
GET    /api/review/:token
POST   /api/review/:token/posts/:postId/comments
POST   /api/review/:token/posts/:postId/approve
POST   /api/review/:token/posts/:postId/request-change
POST   /api/review/:token/month/approve
POST   /api/review-links/:id/revoke
```

## Export
```http
POST   /api/clients/:clientId/calendar/:month/export/pptx
POST   /api/clients/:clientId/calendar/:month/export/pdf
GET    /api/export-jobs/:jobId
```

---

# 8) Core server implementation sketch

## `server/src/index.ts`
```ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { registerRoutes } from './routes';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
  credentials: true,
});

await app.register(multipart, {
  limits: { fileSize: 25 * 1024 * 1024 },
});

await registerRoutes(app);

const port = Number(process.env.PORT || 8080);
await app.listen({ port, host: '0.0.0.0' });
```

## `server/src/routes/index.ts`
```ts
import { FastifyInstance } from 'fastify';
import { authRoutes } from './auth';
import { clientRoutes } from './clients';
import { briefRoutes } from './briefs';
import { knowledgeRoutes } from './knowledge';
import { assetRoutes } from './assets';
import { calendarRoutes } from './calendar';
import { reviewRoutes } from './review';
import { exportRoutes } from './exports';

export async function registerRoutes(app: FastifyInstance) {
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(clientRoutes, { prefix: '/api/clients' });
  await app.register(briefRoutes, { prefix: '/api' });
  await app.register(knowledgeRoutes, { prefix: '/api' });
  await app.register(assetRoutes, { prefix: '/api' });
  await app.register(calendarRoutes, { prefix: '/api' });
  await app.register(reviewRoutes, { prefix: '/api' });
  await app.register(exportRoutes, { prefix: '/api' });
}
```

---

# 9) Gemini orchestration service

## Design rule
**Never call Gemini directly from the renderer.**
All AI goes through the server.

## `server/src/services/gemini.service.ts`
```ts
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export const MODELS = {
  planner: process.env.GEMINI_PLANNER_MODEL || 'gemini-3-flash-preview',
  strategist: process.env.GEMINI_STRATEGIST_MODEL || 'gemini-3.1-pro-preview',
  image: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview',
  video: process.env.GEMINI_VIDEO_MODEL || 'veo-3.1-generate-preview',
  videoFast: process.env.GEMINI_VIDEO_FAST_MODEL || 'veo-3.1-fast-generate-preview',
  embedding: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2-preview',
};

export async function generateJson<T>(model: string, prompt: string): Promise<T> {
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      temperature: 0.7,
    },
  });

  const text = response.text || '';
  return JSON.parse(text) as T;
}

export async function embedText(text: string) {
  return ai.models.embedContent({
    model: MODELS.embedding,
    contents: text,
  });
}

export async function analyzeAsset(base64: string, mimeType: string, prompt: string) {
  return ai.models.generateContent({
    model: MODELS.planner,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { data: base64, mimeType } },
        { text: prompt },
      ],
    }],
    config: { responseMimeType: 'application/json' },
  });
}
```

---

# 10) Calendar generation flow

## Input sources
- client brief
- top relevant knowledge chunks
- uploaded assets + analysis
- optional website notes
- optional previous month learnings

## Worker flow
```text
1. Validate client brief completeness
2. Retrieve top-K knowledge chunks
3. Fetch asset summaries
4. Build planning prompt
5. Call Gemini planner model
6. Validate JSON schema
7. Save calendar month
8. Save posts
9. Queue visual reference search jobs
10. Return job status to desktop
```

## `generateMonth.worker.ts`
```ts
import { queue } from './queue';
import { db } from '../db/prisma';
import { buildPlanningPrompt } from '../../packages/prompts/briefToCalendar';
import { generateJson, MODELS } from '../services/gemini.service';
import { retrieveContext } from '../services/retrieval.service';

queue.process('generate-month', async (job) => {
  const { clientId, month, pieceCount } = job.data;

  const client = await db.client.findUnique({
    where: { id: clientId },
    include: { brief: true, assets: true },
  });
  if (!client?.brief) throw new Error('Client brief missing');

  const retrieved = await retrieveContext(clientId, `${client.name} ${month} content calendar`);

  const prompt = buildPlanningPrompt({
    brief: client.brief,
    assets: client.assets,
    retrieved,
    month,
    pieceCount,
  });

  const result = await generateJson<{ strategySummary: any; posts: any[] }>(MODELS.planner, prompt);

  const calendarMonth = await db.calendarMonth.create({
    data: {
      clientId,
      month,
      status: 'draft',
      strategy: result.strategySummary,
    },
  });

  for (const post of result.posts) {
    await db.calendarPost.create({
      data: {
        calendarMonthId: calendarMonth.id,
        date: post.date,
        title: post.title,
        pillar: post.pillar,
        platform: post.platform,
        format: post.format,
        hook: post.hook,
        keyMessage: post.keyMessage,
        caption: post.caption,
        cta: post.cta,
        hashtags: post.hashtags,
        visualDirection: post.visualDirection,
        referenceQuery: post.referenceSearchQuery,
        rationale: post.ideaRationale,
        timing: post.timing,
      },
    });
  }

  return { calendarMonthId: calendarMonth.id };
});
```

---

# 11) Preview link architecture

## Rule
Clients never access desktop or internal auth.
They get a tokenized review URL.

## Token flow
```text
Desktop user clicks “Create Review Link”
→ backend creates ReviewLink token
→ returns URL: https://preview.radix.app/review/<token>
→ client opens URL in browser
→ preview app fetches review payload by token
```

## Review API response
```json
{
  "client": { "name": "Al Fardan Exchange" },
  "month": "2026-08",
  "posts": [
    {
      "id": "post_123",
      "date": "2026-08-12",
      "platform": "Instagram",
      "format": "Carousel",
      "caption": "...",
      "cta": "...",
      "visualDirection": "...",
      "visualRefImages": [
        { "imageUrl": "...", "sourceUrl": "...", "description": "..." }
      ],
      "status": "client-review"
    }
  ]
}
```

## Client actions
- add comment
- approve post
- request changes
- approve month

---

# 12) Desktop frontend API layer

## `apps/desktop/src/lib/api.ts`
```ts
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }

  return res.json();
}

export const clientsApi = {
  list: () => api('/api/clients'),
  get: (clientId: string) => api(`/api/clients/${clientId}`),
  create: (payload: any) => api('/api/clients', { method: 'POST', body: JSON.stringify(payload) }),
};

export const briefApi = {
  get: (clientId: string) => api(`/api/clients/${clientId}/brief`),
  save: (clientId: string, payload: any) => api(`/api/clients/${clientId}/brief`, { method: 'PUT', body: JSON.stringify(payload) }),
  completeness: (clientId: string) => api(`/api/clients/${clientId}/brief/completeness`),
  promptPack: (clientId: string) => api(`/api/clients/${clientId}/brief/prompt-pack`),
};
```

---

# 13) Brief page component contract

## Required tabs in desktop app
### `ClientBrief.tsx`
Sections:
- Brand basics
- Objective
- Audience
- Products/services
- Tone
- Brand do / don’t
- Pillars
- Campaign moments
- Channels / cadence
- Compliance
- Approvers
- Success definition
- Past learnings
- AI prompt pack preview

## Completion logic
```ts
export function getBriefCompleteness(brief: ClientBriefDto): number {
  const required = [
    brief.objective,
    brief.audience,
    brief.tone,
    brief.brandDo,
    brief.brandDont,
    brief.products?.length,
    brief.pillars?.length,
    brief.channels?.length,
  ];

  const filled = required.filter(Boolean).length;
  return Math.round((filled / required.length) * 100);
}
```

Generation button should be disabled if completeness < threshold (for example 70%).

---

# 14) Asset upload and analysis

## Upload flow
```text
1. user uploads image/pdf/doc
2. server stores file
3. if image → generate thumbnail
4. if text/pdf/doc → extract text + chunk
5. if image → queue Gemini asset analysis
6. persist analysis JSON on asset record
```

## Asset analysis JSON target
```json
{
  "description": "premium travel lifestyle image with clean composition",
  "mood": "aspirational, warm, clean",
  "tags": ["travel", "card", "premium"],
  "colors": ["gold", "white", "black"],
  "qualityScore": 9,
  "bestFit": ["Instagram", "Stories"],
  "linkedProducts": ["Travelez Card"],
  "suggestion": "Use for lifestyle travel benefit messaging.",
  "safeForClientUse": true
}
```

---

# 15) Retrieval layer

## Retrieval service
- chunk text docs into 500–1200 token windows
- embed with Gemini embedding model
- store vectors in pgvector
- query top 8–12 chunks per generation

## `retrieveContext()`
```ts
export async function retrieveContext(clientId: string, query: string) {
  // 1. embed query
  // 2. vector similarity search over client knowledge chunks
  // 3. return top-K chunks with metadata
  return [];
}
```

---

# 16) Export flow

## PowerPoint export
Slides:
1. Cover
2. Monthly strategy summary
3. Pillar/channel split
4+. One or two posts per slide
5. Final approval slide

## Export worker contract
```ts
queue.process('export-pptx', async (job) => {
  const { clientId, month } = job.data;
  // fetch calendar + client + references
  // generate pptx
  // upload to storage
  // update export job record
});
```

---

# 17) Internal review states

Use these statuses:
- `draft`
- `internal-review`
- `client-review`
- `changes-requested`
- `approved`
- `archived`

Each edit should create a `PostVersion` snapshot.

---

# 18) Security rules

- No Gemini or Claude keys in renderer code
- Desktop app authenticates with backend
- Preview app uses signed token only
- Tokens revocable
- Expiry optional
- Signed file URLs for storage
- Server-side upload validation
- Rate-limit review comments endpoints
- Audit every approval action

---

# 19) Docker compose

```yaml
version: '3.9'
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: radix_planner
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    ports:
      - '6379:6379'

volumes:
  postgres_data:
```

---

# 20) Package scripts

## root `package.json`
```json
{
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*",
    "server"
  ],
  "scripts": {
    "dev:desktop": "npm --workspace apps/desktop run dev",
    "dev:preview": "npm --workspace apps/preview-web run dev",
    "dev:server": "npm --workspace server run dev",
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:desktop\" \"npm run dev:preview\"",
    "build": "npm run build --workspaces",
    "prisma:migrate": "npm --workspace server run prisma:migrate",
    "prisma:generate": "npm --workspace server run prisma:generate"
  }
}
```

---

# 21) Build order

## Phase 1 — foundation
- normalize repo
- backend scaffold
- Prisma schema
- auth
- client CRUD
- brief CRUD

## Phase 2 — knowledge + assets
- uploads
- storage
- doc extraction
- chunking + embeddings
- asset analysis

## Phase 3 — generation
- Gemini orchestration
- month generation
- single-post regeneration
- internal review editing

## Phase 4 — preview portal
- token links
- comments
- approvals
- revoke links

## Phase 5 — export + hardening
- PPTX export
- PDF export
- audit logs
- permissions
- QA

---

# 22) Definition of done for V1

The app is V1 complete when:
- team can log into desktop app
- team can create multiple clients
- each client has a mandatory brief
- docs/assets upload and persist
- Gemini can generate an entire month from brief + retrieval + assets
- internal team can edit posts
- client can open preview link and comment/approve
- team can export PowerPoint
- all data persists in Postgres
- no AI provider keys live in the renderer

---

# 23) Non-goals for V1

Do not build yet:
- public signup
- billing
- social publishing integrations
- multi-language translation workflows
- public admin panel
- full white-label portals
- mobile app
- advanced analytics suite

This version is:
**internal desktop OS + secure review portal**

