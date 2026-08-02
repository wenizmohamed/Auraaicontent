#!/usr/bin/env node
/**
 * End-to-end smoke test for the content agent.
 *
 * Nothing else in the repo proves the agent works end to end: session create,
 * run kickoff, LLM tool-calling loop, tool execution, event persistence and a
 * terminal state. This script drives one real, short, read-only agent run over
 * plain HTTP and asserts each of those stages.
 *
 * Transport note: the agent streams over Socket.IO, but every event is also
 * persisted to AgentEvent (realtime/io.ts emitAndPersist) and exposed via
 * GET /api/agent/sessions/:uid, and POST /api/agent/runs kicks a run off over
 * HTTP. So the honest no-socket harness is: start the run over HTTP, poll the
 * persisted events until a terminal state, and assert on those. No fake pass:
 * if the loop hangs or errors, the poll sees it and the script exits 1.
 *
 * The run itself is read-only by construction: the prompt asks which calendar
 * months already exist for a client and forbids creating anything. It directs
 * the agent at client_switch (present in every build, returns recent months)
 * and at calendar_read when available (the newer read-only calendar tool), so
 * the test passes on both the current and the next agent build without ever
 * writing calendar data. A DB snapshot before the run verifies no CalendarMonth,
 * CalendarPost or Asset rows appeared for the test client, and cleanup removes
 * every row the run created (AgentSession + messages + events, the /history
 * Generation row, UsageEvent rows keyed by the session uid) and then proves
 * they are gone. Deleted UsageEvent cost is printed so real provider spend is
 * not silently dropped from the ledger.
 *
 * Deliberately dependency-free (same policy as e2e-price-gating.mjs): global
 * fetch (node >= 18), execFileSync for token minting and psql.
 *
 * Run on the server (it mints tokens with the local JWT secret):
 *   node scripts/agent-smoke.mjs
 *   BASE=http://127.0.0.1:8080 PROD_DIR=/opt/radix-v2/server node scripts/agent-smoke.mjs
 *
 * Exits 0 when every assertion passes, 1 on any failure.
 */

import { execFileSync } from 'node:child_process';

const PROD_DIR = process.env.PROD_DIR || '/opt/radix-v2/server';
const BASE = process.env.BASE || 'http://127.0.0.1:8080';
const ORG = process.env.E2E_ORG_ID || 'org_radix_media';
const RUN_TIMEOUT_MS = parseInt(process.env.RUN_TIMEOUT_MS || '180000', 10);
const POLL_MS = 2500;

/* ------------------------------------------------------------------ */
/* Check + report plumbing (same contract as e2e-price-gating.mjs)     */
/* ------------------------------------------------------------------ */

const failures = [];
function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ` :: ${detail}` : ''}`);
    failures.push(name);
  }
}

/** Interpolated-into-SQL values must match a strict shape first. */
function safe(label, value, re) {
  const v = String(value ?? '');
  if (!re.test(v)) throw new Error(`unsafe ${label}: ${JSON.stringify(v)}`);
  return v;
}
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const TS_RE = /^[0-9 .:+-]{19,40}$/;

/* ------------------------------------------------------------------ */
/* Auth + DB helpers                                                   */
/* ------------------------------------------------------------------ */

/** Mint a JWT with the server's own signer so the test uses real auth. */
function mintToken({ userId, email, role, orgRole }) {
  const code = `const {signToken}=require('./dist/middleware/auth.js');`
    + `console.log(signToken(${JSON.stringify({ userId, email, role, orgId: ORG, orgRole })}))`;
  return execFileSync('node', ['--env-file=.env', '-e', code], { cwd: PROD_DIR, encoding: 'utf8' }).trim();
}

let cachedDbUrl = null;
function dbUrl() {
  if (!cachedDbUrl) {
    cachedDbUrl = execFileSync('bash', ['-c', `grep '^DATABASE_URL=' ${PROD_DIR}/.env | cut -d= -f2- | tr -d '"'`], { encoding: 'utf8' }).trim();
    if (!cachedDbUrl) throw new Error(`DATABASE_URL not found in ${PROD_DIR}/.env`);
  }
  return cachedDbUrl;
}

function sql(query) {
  return execFileSync('psql', [dbUrl(), '-X', '-t', '-A', '-c', query], { encoding: 'utf8' }).trim();
}

/** Pick the org client with the most calendar months so the answer is real. */
function pickClient() {
  const org = safe('org', ORG, ID_RE);
  const out = sql(
    `SELECT c.id || E'\\x1f' || c.name FROM "Client" c `
    + `LEFT JOIN "CalendarMonth" m ON m."clientId" = c.id AND m."orgId" = c."orgId" `
    + `WHERE c."orgId" = '${org}' GROUP BY c.id, c.name ORDER BY COUNT(m.id) DESC, c.name ASC LIMIT 1;`,
  );
  if (!out) return null;
  const [id, name] = out.split('\x1f');
  return { id, name };
}

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Event helpers                                                       */
/* ------------------------------------------------------------------ */

const byType = (events, type) => events.filter((e) => e.type === type);
const trim = (v, n) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > n ? `${s.slice(0, n)}...` : (s ?? '');
};

function printTranscript(session) {
  const events = session.events ?? [];
  console.log(`\nTRANSCRIPT (${events.length} persisted events, session ${session.uid})`);
  for (const e of events) {
    const p = e.payload ?? {};
    switch (e.type) {
      case 'agent:start':
        console.log(`  [start]        input=${trim(p.input, 110)}`);
        break;
      case 'agent:thought':
        console.log(`  [thought]      ${trim(p.text, 160)}`);
        break;
      case 'agent:tool_start':
        console.log(`  [tool_start]   ${p.tool} args=${trim(p.args, 160)}`);
        break;
      case 'agent:tool_result':
        console.log(`  [tool_result]  ${p.tool} ${p.ok ? 'ok' : `ERROR: ${trim(p.error, 160)}`}${p.ok ? ` result=${trim(p.result, 200)}` : ''}`);
        break;
      case 'agent:complete':
        console.log(`  [complete]     ${trim(p.summary ?? '', 160)}`);
        break;
      case 'agent:error':
        console.log(`  [error]        ${trim(p.message, 200)}`);
        break;
      default:
        break; // agent:message deltas are noise here; final text printed below
    }
  }
  const assistant = (session.messages ?? []).filter((m) => m.role === 'assistant').pop();
  if (assistant) {
    console.log(`\nFINAL ASSISTANT MESSAGE:\n  ${trim(assistant.content, 800).replace(/\n/g, '\n  ')}`);
  }
}

/* ------------------------------------------------------------------ */
/* Cleanup: remove everything the run created, then prove it is gone.  */
/* ------------------------------------------------------------------ */

async function cleanup({ token, uid, clientId, t0 }) {
  console.log('\nCLEANUP');
  const org = safe('org', ORG, ID_RE);
  const uidS = safe('session uid', uid, ID_RE);
  const cid = safe('client id', clientId, ID_RE);
  const ts = safe('t0', t0, TS_RE);

  // Best-effort cancel in case the loop is still going (e.g. timeout path).
  try { await api('POST', `/api/agent/runs/${uidS}/cancel`, token); } catch { /* server gone */ }
  await sleep(1500);

  // 1. Any calendar rows the run created for the test client (there should be
  //    none; the prompt is read-only). Posts first, then months.
  const newMonthIds = sql(
    `SELECT COALESCE(string_agg(id, ','), '') FROM "CalendarMonth" `
    + `WHERE "orgId"='${org}' AND "clientId"='${cid}' AND "createdAt" >= '${ts}';`,
  );
  if (newMonthIds) {
    const ids = newMonthIds.split(',').map((i) => safe('month id', i, ID_RE));
    const inList = ids.map((i) => `'${i}'`).join(',');
    const posts = sql(`WITH d AS (DELETE FROM "CalendarPost" WHERE "calendarMonthId" IN (${inList}) RETURNING 1) SELECT count(*) FROM d;`);
    const months = sql(`WITH d AS (DELETE FROM "CalendarMonth" WHERE id IN (${inList}) RETURNING 1) SELECT count(*) FROM d;`);
    console.log(`  removed ${months} stray CalendarMonth + ${posts} CalendarPost rows created by the run`);
  }
  const strayAssets = sql(
    `WITH d AS (DELETE FROM "Asset" WHERE "orgId"='${org}' AND "clientId"='${cid}' AND "createdAt" >= '${ts}' RETURNING 1) SELECT count(*) FROM d;`,
  );
  if (strayAssets !== '0') console.log(`  removed ${strayAssets} stray Asset rows created by the run`);

  // 2. Usage ledger rows for this run (ref = session uid). These record real
  //    provider spend, so print the cost being removed instead of losing it
  //    silently.
  const usage = sql(`SELECT count(*) || '|' || COALESCE(sum("costUsd"), 0) FROM "UsageEvent" WHERE "orgId"='${org}' AND ref='${uidS}';`);
  const [usageCount, usageCost] = usage.split('|');
  if (usageCount !== '0') {
    sql(`DELETE FROM "UsageEvent" WHERE "orgId"='${org}' AND ref='${uidS}';`);
    console.log(`  removed ${usageCount} UsageEvent rows (real spend for this smoke run: $${usageCost})`);
  }

  // 3. The /history Generation row the loop records for the run.
  const gens = sql(
    `WITH d AS (DELETE FROM "Generation" WHERE "orgId"='${org}' AND surface='agent' AND metadata->>'sessionUid'='${uidS}' RETURNING 1) SELECT count(*) FROM d;`,
  );
  if (gens !== '0') console.log(`  removed ${gens} Generation history rows`);

  // 4. The session itself + its messages and events.
  const sid = sql(`SELECT id FROM "AgentSession" WHERE uid='${uidS}' AND "orgId"='${org}';`);
  if (sid) {
    const sidS = safe('session id', sid, ID_RE);
    const ev = sql(`WITH d AS (DELETE FROM "AgentEvent" WHERE "sessionId"='${sidS}' RETURNING 1) SELECT count(*) FROM d;`);
    const msg = sql(`WITH d AS (DELETE FROM "AgentMessage" WHERE "sessionId"='${sidS}' RETURNING 1) SELECT count(*) FROM d;`);
    sql(`DELETE FROM "AgentSession" WHERE id='${sidS}';`);
    console.log(`  removed AgentSession ${uidS} (+ ${msg} messages, ${ev} events)`);
  }

  // 5. Prove it is gone: API 404 and zero rows across every touched table.
  const gone = await api('GET', `/api/agent/sessions/${uidS}`, token);
  check('cleanup: session no longer served by the API', gone.status === 404, `GET returned ${gone.status}`);
  const residue = sql(
    `SELECT (SELECT count(*) FROM "AgentSession" WHERE uid='${uidS}')`
    + ` + (SELECT count(*) FROM "Generation" WHERE "orgId"='${org}' AND surface='agent' AND metadata->>'sessionUid'='${uidS}')`
    + ` + (SELECT count(*) FROM "UsageEvent" WHERE "orgId"='${org}' AND ref='${uidS}')`
    + ` + (SELECT count(*) FROM "CalendarMonth" WHERE "orgId"='${org}' AND "clientId"='${cid}' AND "createdAt" >= '${ts}')`
    + ` + (SELECT count(*) FROM "Asset" WHERE "orgId"='${org}' AND "clientId"='${cid}' AND "createdAt" >= '${ts}');`,
  );
  check('cleanup: zero rows left behind in the DB', residue === '0', `${residue} residual rows`);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

(async () => {
  console.log(`Agent end-to-end smoke test against ${BASE} (org ${ORG})\n`);

  // API up?
  let health;
  try {
    health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  } catch (err) {
    console.error(`API not reachable at ${BASE}: ${err?.message || err}`);
    process.exit(1);
  }
  check('API is reachable', health?.status === 'ok', JSON.stringify(health).slice(0, 120));

  const token = mintToken({
    userId: process.env.E2E_OWNER_ID || 'cmnx84r0i0000kzc1w30vij0k',
    email: process.env.E2E_OWNER_EMAIL || 'weni.mohamed@gmail.com',
    role: 'ADMIN', orgRole: 'OWNER',
  });

  const client = pickClient();
  if (!client) {
    console.error(`No client found in org ${ORG}; cannot run a grounded agent smoke test.`);
    process.exit(1);
  }
  console.log(`  test client: ${client.name} (${client.id})\n`);

  // DB-clock snapshot taken BEFORE the run; the mutation guard and cleanup key
  // off it, so clock skew between this host and postgres cannot hide writes.
  const t0 = sql('SELECT now()::text;');

  // 1. Create a session over HTTP.
  console.log('RUN');
  const created = await api('POST', '/api/agent/sessions', token, {
    title: 'agent-smoke (auto-deleted)',
    clientId: client.id,
  });
  check('session created over HTTP', created.status === 200 && !!created.json?.uid,
    `status ${created.status} body ${JSON.stringify(created.json).slice(0, 160)}`);
  const uid = created.json?.uid;
  if (!uid) {
    console.log(`\n${failures.length} FAILED: ${failures.join(', ')}`);
    process.exit(1);
  }

  // Read-only by construction, and tool-requiring on BOTH agent builds:
  // client_switch exists everywhere and returns the recent months;
  // calendar_read (newer builds) is the proper read-only listing.
  const input =
    `Read-only check. First call the client_switch tool with clientId "${client.id}" to load the client "${client.name}". `
    + `Then report which calendar months already exist for this client, with each month's status. `
    + `If a calendar_read tool is available, use it to list the months; otherwise use what client_switch returned. `
    + `Do not create, plan, schedule, generate, publish, modify or delete anything. `
    + `Finish with a one-paragraph summary of the existing months and stop.`;

  let terminal = null; // last session snapshot once a terminal state is seen
  let last = null;
  try {
    // 2. Kick off the run over HTTP.
    const run = await api('POST', '/api/agent/runs', token, { sessionUid: uid, input, clientId: client.id });
    check('run accepted (started: true)', run.status === 200 && run.json?.started === true,
      `status ${run.status} body ${JSON.stringify(run.json).slice(0, 160)}`);

    // 3. Poll the persisted events until a terminal state or timeout.
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const res = await api('GET', `/api/agent/sessions/${uid}`, token);
      if (res.status !== 200 || !res.json?.session) continue;
      last = res.json.session;
      const events = last.events ?? [];
      const statusDone = last.status === 'completed' || last.status === 'failed';
      const eventDone = byType(events, 'agent:complete').length > 0 || byType(events, 'agent:error').length > 0;
      if (statusDone || eventDone) {
        // Event persistence is fire-and-forget; give stragglers a moment,
        // then take the final snapshot.
        await sleep(2000);
        const finalRes = await api('GET', `/api/agent/sessions/${uid}`, token);
        terminal = finalRes.json?.session ?? last;
        break;
      }
    }

    check(`run reached a terminal state within ${Math.round(RUN_TIMEOUT_MS / 1000)}s (did not hang)`, !!terminal,
      `last status: ${last?.status ?? 'never fetched'} after ${RUN_TIMEOUT_MS}ms`);

    const snap = terminal ?? last ?? { events: [], messages: [], uid, status: 'unknown' };
    const events = snap.events ?? [];

    printTranscript(snap);

    // 4. Assertions on the run itself.
    console.log('\nCHECKS');
    check('agent:start event persisted (run really started)', byType(events, 'agent:start').length > 0);
    const toolStarts = byType(events, 'agent:tool_start');
    check('at least one tool was invoked', toolStarts.length > 0);
    const unknown = byType(events, 'agent:tool_result').filter((e) => String(e.payload?.error ?? '').startsWith('Unknown tool'));
    check('no tool call hit "Unknown tool"', unknown.length === 0,
      unknown.map((e) => e.payload?.tool).join(', '));
    const failedTools = byType(events, 'agent:tool_result').filter((e) => e.payload?.ok === false);
    check('no tool returned an error', failedTools.length === 0,
      failedTools.map((e) => `${e.payload?.tool}: ${trim(e.payload?.error, 80)}`).join(' | '));
    const errors = byType(events, 'agent:error');
    check('no agent:error events (run did not end in stopReason error)', errors.length === 0,
      errors.map((e) => trim(e.payload?.message, 100)).join(' | '));
    check('session finished with status "completed"', snap.status === 'completed', `status: ${snap.status}`);
    const assistant = (snap.messages ?? []).filter((m) => m.role === 'assistant').pop();
    check('final assistant message persisted and non-empty', !!assistant?.content?.trim());

    // 5. Mutation guard: a read-only run must not have created calendar data
    //    or assets for the test client.
    const org = safe('org', ORG, ID_RE);
    const cid = safe('client id', client.id, ID_RE);
    const ts = safe('t0', t0, TS_RE);
    const created2 = sql(
      `SELECT (SELECT count(*) FROM "CalendarMonth" WHERE "orgId"='${org}' AND "clientId"='${cid}' AND "createdAt" >= '${ts}')`
      + ` + (SELECT count(*) FROM "CalendarPost" p JOIN "CalendarMonth" m ON p."calendarMonthId" = m.id WHERE m."clientId"='${cid}' AND p."createdAt" >= '${ts}')`
      + ` + (SELECT count(*) FROM "Asset" WHERE "orgId"='${org}' AND "clientId"='${cid}' AND "createdAt" >= '${ts}');`,
    );
    check('read-only run created no calendar/asset data', created2 === '0', `${created2} new rows (cleanup will remove them)`);
  } finally {
    // Cleanup always runs, even when checks fail, so a broken run still
    // leaves nothing behind.
    try {
      await cleanup({ token, uid, clientId: client.id, t0 });
    } catch (err) {
      check('cleanup completed', false, err?.message || String(err));
    }
  }

  console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED: ${failures.join(', ')}`}`);
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((err) => {
  console.error('agent smoke run failed:', err?.message || err);
  process.exit(1);
});
