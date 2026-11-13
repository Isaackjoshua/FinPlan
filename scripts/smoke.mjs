// End-to-end smoke test: drives the real pages over HTTP with no JavaScript, like a browser with JS off.
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const MAIL = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
function store(res) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    const name = pair.slice(0, i), value = pair.slice(i + 1);
    if (value === '' || /max-age=0/i.test(c)) jar.delete(name); else jar.set(name, value);
  }
}
async function get(path) {
  let url = new URL(path, BASE);
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url, { headers: { cookie: cookieHeader() }, redirect: 'manual' });
    store(res);
    if (res.status >= 300 && res.status < 400) { url = new URL(res.headers.get('location'), url); continue; }
    return { url: url.pathname + url.search, status: res.status, html: await res.text() };
  }
  throw new Error('redirect loop');
}
function forms(html) {
  return html.split('<form').slice(1).map((chunk) => {
    const body = chunk.slice(0, chunk.indexOf('</form>'));
    const hidden = {};
    for (const m of body.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
      const name = /name="([^"]*)"/.exec(m[0])?.[1]; const value = /value="([^"]*)"/.exec(m[0])?.[1] ?? '';
      if (name) hidden[name] = value.replaceAll('&quot;', '"').replaceAll('&amp;', '&');
    }
    return { body, hidden };
  });
}
async function submit(path, pick, fields) {
  const page = await get(path);
  const form = forms(page.html).find((f) => pick(f));
  if (!form) throw new Error(`no matching form on ${path} (landed on ${page.url})`);
  const data = new FormData();
  for (const [k, v] of Object.entries({ ...form.hidden, ...fields })) for (const one of [v].flat()) data.append(k, one);
  const res = await fetch(new URL(page.url, BASE), { method: 'POST', body: data, redirect: 'manual', headers: { cookie: cookieHeader(), origin: BASE } });
  store(res);
  const loc = res.headers.get('location');
  if (!loc) throw new Error(`POST ${path} gave ${res.status} with no redirect`);
  return decodeURIComponent(loc);
}
const has = (name) => (f) => f.body.includes(`name="${name}"`);
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); if (!ok) process.exitCode = 1; };

const email = `smoke-${Date.now()}@example.test`, password = 'correct horse battery';

check('signed-out dashboard redirects to sign-in', (await get('/dashboard')).url.startsWith('/sign-in'));
check('short password rejected', (await submit('/sign-up', has('email'), { name: 'Ada', email, password: 'short' })).includes('error='));
check('sign-up goes to check-email', (await submit('/sign-up', has('email'), { name: 'Ada', email, password })) === '/check-email');
check('cannot sign in before verifying', (await submit('/sign-in', has('email'), { email, password })) === '/check-email');
check('still signed out', (await get('/dashboard')).url.startsWith('/sign-in'));

await new Promise((r) => setTimeout(r, 500));
const inbox = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`)).json();
const msg = await (await fetch(`${MAIL}/api/v1/message/${inbox.messages[0].ID}`)).json();
const link = /https?:\/\/\S+/.exec(msg.Text)[0];
await get(link);
jar.clear(); // prove sign-in works on its own, not just the auto sign-in after verifying
check('wrong password rejected', (await submit('/sign-in', has('email'), { email, password: 'wrong password!!' })).includes('error='));
check('sign-in works after verifying', (await submit('/sign-in', has('email'), { email, password })) === '/dashboard');
check('new user is sent to onboarding', (await get('/dashboard')).url === '/onboarding');
check('onboarding rejects a bad currency', (await submit('/onboarding', has('currency'), { country: 'KE', currency: 'XYZ1' })).includes('error='));
await submit('/onboarding', has('currency'), { country: 'KE', currency: 'KES' });
check('onboarding done', (await get('/dashboard')).url === '/dashboard');

const add = (kind, fields) => submit('/profile', (f) => f.hidden.kind === kind && !f.hidden.id, fields);
check('bad amount rejected', (await add('income', { label: 'Salary', amount: 'lots', frequency: 'monthly' })).includes('error='));
await add('income', { label: 'Salary', amount: '120,000', frequency: 'monthly' });
await add('expense', { label: 'Rent', amount: '45000', frequency: 'monthly', category: 'housing', essential: 'on' });
await add('expense', { label: 'Food', amount: '5000', frequency: 'weekly', category: 'food', essential: 'on' });
await add('debt', { label: 'Mobile loan', debtKind: 'mobile_loan', balance: '30000', rate: '36', minimum: '3000' });
await add('savings', { label: 'Buffer', balance: '66666.67', rate: '8.5', emergency: 'on' });
let dash = (await get('/dashboard')).html;
const txt = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ');
check('dashboard shows income', txt(dash).includes('KES 120,000.00'), txt(dash).slice(0, 400));
check('dashboard shows expenses (45,000 + 5,000×52/12)', txt(dash).includes('KES 66,666.67'));
check('dashboard shows surplus (120,000 − 66,666.67 − 3,000)', txt(dash).includes('KES 50,333.33'));
check('emergency fund covers 1.0 months', txt(dash).includes('1.0 months'));

await submit('/goals', (f) => has('title')(f) && !f.hidden.id, { title: 'Three months of cover', kind: 'emergency_fund', target: '200000', current: '66666.67', priority: '1' });
check('goal shows progress', txt((await get('/goals')).html).includes('33%'));

const plan = (summary) => submit('/plan', has('summary'), { summary, 'budget.housing': '45000', 'budget.food': '20000', debtStrategy: 'avalanche', extraDebt: '5000', emergencyMonths: '3' });
check('plan v1 saved', (await plan('First plan: clear the mobile loan')).includes('notice='));
check('plan v2 saved', (await plan('Second plan: <b>bold</b> savings push')).includes('notice='));
let planPage = (await get('/plan')).html;
check('v2 is current', /Version 2 · saved/.test(txt(planPage)));
check('agent/user text is escaped, not rendered as HTML', planPage.includes('&lt;b&gt;bold&lt;/b&gt;') && !planPage.includes('<b>bold</b>'));
// Mobile loan: 30,000 at 36% (3% a month), paying 3,000 minimum + 5,000 extra = 8,000 a month.
//   30,000 → 22,900 → 15,587 → 8,054.61 → 296.25 → paid in month 5 (March 2027 from November 2026).
const planText = txt(planPage);
const expectFreeBy = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 4, 1)));
check('plan shows debt-free date from the engine', planText.replace(/\s/g, '').includes(`Debt-free in 5 months (${expectFreeBy})`.replace(/\s/g, '')), planText.slice(planText.indexOf('works out'), planText.indexOf('works out') + 500));
check('plan shows total interest (2,305.14)', planText.includes('KES 2,305.14'));
check('plan shows unallocated income (120,000 − 65,000 − 8,000)', planText.includes('KES 47,000.00'));
check('plan shows emergency fund target (3 × 66,666.67)', planText.includes('KES 200,000.01'));
check('revert to v1', (await submit('/plan', (f) => f.hidden.version === '1', {})).includes('Version 1 is now'));
planPage = txt((await get('/plan')).html);
check('v1 is current again and v2 is kept', /Version 1 · saved/.test(planPage) && planPage.includes('Second plan'));
dash = txt((await get('/dashboard')).html);
check('dashboard shows reverted plan', dash.includes('First plan: clear the mobile loan'));
check('dashboard shows debt-free date', dash.includes(`Debt-free by ${expectFreeBy}`));

check('check-in with reversed dates rejected', (await submit('/check-ins', has('periodStart'), { periodStart: '2026-10-31', periodEnd: '2026-10-01', income: '1', debt: '0', savings: '0' })).includes('error='));
await submit('/check-ins', has('periodStart'), { periodStart: '2026-10-01', periodEnd: '2026-10-31', income: '120000', 'spend.housing': '45000', 'spend.food': '24000', debt: '8000', savings: '10000', note: 'Food ran over' });
check('check-in listed with variance', txt((await get('/check-ins')).html).includes('KES 4,000.00 over'));

// Lessons. This profile has a 36% loan, so interest should lead the suggestions.
let lessons = txt((await get('/lessons')).html);
check('lessons page lists the catalogue', lessons.includes('0 of 10 completed') && lessons.includes('Your first budget'));
const suggested = lessons.slice(lessons.indexOf('Suggested for your situation'), lessons.indexOf('All lessons'));
check('suggestions fit a profile with expensive debt', suggested.includes('How interest works'), suggested.slice(0, 300));
check('filters narrow the list', !txt((await get('/lessons?topic=debt&level=3')).html).split('All lessons')[1].includes('Your first budget'));
check('unknown lesson is a 404', (await get('/lessons/does-not-exist')).status === 404);
const lessonPath = '/lessons/how-interest-works';
check('lesson page renders the worked example', txt((await get(lessonPath)).html).includes('2% of 10,000 is 200'));
check('opening a lesson marks it in progress', txt((await get('/lessons')).html).includes('In progress'));
check('unanswered quiz is rejected', (await submit(lessonPath, has('q0'), {})).includes('error='));
await submit(lessonPath, has('q0'), { q0: '0', q1: '0', q2: '0' });
let result = txt((await get(lessonPath + '?result=1')).html);
check('wrong answers get feedback and do not complete', result.includes('0 of 3 correct') && result.includes('try again') && result.includes('1% of 50,000 is 500'));
await submit(lessonPath, has('q0'), { q0: '1', q1: '2', q2: '1' });
result = txt((await get(lessonPath + '?result=1')).html);
check('right answers complete the lesson', result.includes('3 of 3 correct') && result.includes('Lesson completed'));
lessons = txt((await get('/lessons')).html);
check('progress is counted', lessons.includes('1 of 10 completed'));
check('a completed lesson is no longer suggested', !lessons.slice(lessons.indexOf('Suggested for your situation'), lessons.indexOf('All lessons')).includes('How interest works'));
check('dashboard shows lesson progress', txt((await get('/dashboard')).html).includes('1 of 10 completed'));

// Connect an AI app, the way an MCP client does it: discover, register, ask the user, exchange, call.
const MCP = process.env.MCP_URL ?? 'http://localhost:3001/mcp';
const { createHash, randomBytes } = await import('node:crypto');
const rpc = (token, method, params) => fetch(MCP, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token && { authorization: `Bearer ${token}` }) },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
});
const callTool = async (token, name, args = {}) => {
  const res = await rpc(token, 'tools/call', { name, arguments: args });
  // Older-protocol requests are answered as a one-event stream; newer ones as plain JSON.
  const text = await res.text();
  const json = res.status === 200 ? JSON.parse(text.startsWith('{') ? text : /^data: (.*)$/m.exec(text)[1]) : null;
  return { status: res.status, challenge: res.headers.get('www-authenticate'), body: json?.result ?? null };
};

const unauth = await rpc(null, 'tools/list');
const metadataUrl = /resource_metadata="([^"]+)"/.exec(unauth.headers.get('www-authenticate') ?? '')?.[1];
check('MCP server answers 401 and says where its metadata is', unauth.status === 401 && !!metadataUrl);
const resourceMeta = await (await fetch(metadataUrl)).json();
check('metadata names this site as the authorisation server', resourceMeta.resource === MCP && resourceMeta.authorization_servers[0] === new URL(BASE).origin, JSON.stringify(resourceMeta));
const asMeta = await (await fetch(`${resourceMeta.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
check('authorisation server metadata is served through the web app', asMeta.issuer === new URL(BASE).origin && asMeta.code_challenge_methods_supported?.includes('S256') && asMeta.client_id_metadata_document_supported === true, JSON.stringify(asMeta).slice(0, 300));

const redirectUri = 'http://127.0.0.1:9999/callback';
const registered = await (await fetch(asMeta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Smoke <b>Agent</b>', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) })).json();
check('the app registers itself', !!registered.client_id, JSON.stringify(registered));

async function authorise(scope) {
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({ client_id: registered.client_id, response_type: 'code', redirect_uri: redirectUri, scope, state: 'xyz', resource: MCP, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  return { verifier, page: await get(`${asMeta.authorization_endpoint}?${query}`) };
}
async function finish(returnTo, verifier) {
  const back = await fetch(returnTo, { headers: { cookie: cookieHeader() }, redirect: 'manual' });
  store(back);
  const callback = new URL(back.headers.get('location'));
  if (!callback.searchParams.get('code')) return { callback };
  const tokens = await (await fetch(asMeta.token_endpoint, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: callback.searchParams.get('code'), redirect_uri: redirectUri, code_verifier: verifier, client_id: registered.client_id, resource: MCP }) })).json();
  return { callback, tokens };
}

let consent = await authorise('finance:read finance:write');
const consentText = txt(consent.page.html);
check('authorising lands on the consent page', consent.page.url.startsWith('/connect/') && consentText.includes('wants to connect to your FinPlan account'), consent.page.url);
check('consent page names the app as plain text', consent.page.html.includes('Smoke &lt;b&gt;Agent&lt;/b&gt;') && !consent.page.html.includes('<b>Agent</b>'));
check('consent page shows where the user will be sent and both permissions', consentText.includes('127.0.0.1:9999') && consentText.includes('See your financial information') && consentText.includes('Make changes for you'));
const connectPath = consent.page.url;
check('nothing ticked is rejected', (await submit(connectPath, has('decision'), { decision: 'allow', scope: [] })).includes('error='));
check('allowing changes needs the password', (await submit(connectPath, has('decision'), { decision: 'allow', scope: ['finance:read', 'finance:write'], password: 'not my password' })).includes('error='));

// Read access only.
let done = await finish(await submit(connectPath, has('decision'), { decision: 'allow', scope: 'finance:read' }), consent.verifier);
check('the app is sent back with a code and our identity', done.callback.searchParams.get('iss') === new URL(BASE).origin && done.callback.searchParams.get('state') === 'xyz');
check('tokens are issued for read access only', done.tokens?.scope === 'finance:read' && done.tokens?.token_type === 'Bearer' && !!done.tokens?.refresh_token, JSON.stringify(done.tokens));
const readToken = done.tokens.access_token;
const profile = await callTool(readToken, 'get_profile', { sections: ['summary', 'debts'] });
check('agent reads the profile entered by hand', profile.body?.structuredContent?.summary?.monthly_income_minor === 12_000_000 && profile.body.structuredContent.debts[0].user_text.label === 'Mobile loan', JSON.stringify(profile.body).slice(0, 300));
const denied = await callTool(readToken, 'create_goal', { kind: 'other', title: 'x', target_amount_minor: 1 });
check('read-only agent cannot write (403, told which scope)', denied.status === 403 && denied.challenge.includes('finance:write'));

// Connect again, this time allowing changes with the right password. The earlier connection is replaced.
consent = await authorise('finance:read finance:write');
done = await finish(await submit(consent.page.url, has('decision'), { decision: 'allow', scope: ['finance:read', 'finance:write'], password }), consent.verifier);
check('tokens are issued for read and write', done.tokens?.scope === 'finance:read finance:write', JSON.stringify(done.tokens));
check('the replaced connection stops working', (await callTool(readToken, 'get_profile')).status === 401);
const agentToken = done.tokens.access_token;
// For follow-up checks with other tools (for example MCP Inspector): keep the dev token in a file, never in output.
if (process.env.TOKEN_FILE) (await import('node:fs')).writeFileSync(process.env.TOKEN_FILE, agentToken, { mode: 0o600 });
const agentPlan = await callTool(agentToken, 'save_plan_version', { summary: 'Agent plan: avalanche, 7,000 extra', budget: [{ category: 'housing', amount_minor: 4_500_000 }, { category: 'food', amount_minor: 2_000_000 }], debt_strategy: 'avalanche', extra_debt_payment_minor: 700_000 });
check('agent saves plan version 3, computed by the server', agentPlan.body?.structuredContent?.version === 3 && agentPlan.body.structuredContent.results.monthly.debt_payments_minor === 1_000_000, JSON.stringify(agentPlan.body).slice(0, 300));
planPage = txt((await get('/plan')).html);
check('the user sees the agent\'s plan on the website', planPage.includes('Agent plan: avalanche, 7,000 extra') && /Version 3 · saved/.test(planPage));
check('the user can undo it', (await submit('/plan', (f) => f.hidden.version === '1', {})).includes('Version 1 is now'));

// Declining, and arriving signed out.
consent = await authorise('finance:read');
done = await finish(await submit(consent.page.url, has('decision'), { decision: 'deny' }), consent.verifier);
check('declining tells the app access was denied', done.callback.searchParams.get('error') === 'access_denied');
consent = await authorise('finance:read');
const signedInCookies = new Map(jar);
for (const name of [...jar.keys()]) if (name.includes('better-auth')) jar.delete(name);
const asStranger = await get(consent.page.url);
check('a signed-out visitor to the consent page must sign in first', asStranger.url.startsWith('/sign-in?next=%2Fconnect%2F'), asStranger.url);
check('signing in returns to the consent page', (await submit(asStranger.url, has('email'), { email, password })).startsWith('/connect/'));
jar.clear(); for (const [k, v] of signedInCookies) jar.set(k, v);
check('an unknown consent link shows an expiry message', txt((await get('/connect/aaaaaaaaaaaaaaaaaaaaaaaa')).html).includes('This request has expired'));

// The AI apps page: see what the app did, undo it, disconnect it.
const rev = (await callTool(agentToken, 'get_profile')).body.structuredContent.revision;
const invented = await callTool(agentToken, 'update_profile', { expected_revision: rev, items: [{ op: 'upsert', item: { kind: 'income', label: 'Bonus nobody mentioned', amount_minor: 5_000_000, frequency: 'monthly' } }] });
check('agent changes the profile', invented.body?.structuredContent?.revision === rev + 1, JSON.stringify(invented.body).slice(0, 200));
check('the website shows the change', txt((await get('/dashboard')).html).includes('KES 170,000.00'));
let agentsPage = (await get('/agents')).html;
let agentsText = txt(agentsPage);
check('AI apps page gives the address to connect with', agentsText.includes(MCP));
check('it lists the connected app and what it may do', agentsPage.includes('Smoke &lt;b&gt;Agent&lt;/b&gt;') && !agentsPage.includes('<b>Agent</b>') && agentsText.includes('See your information · Make changes'));
const logText = agentsText.slice(agentsText.indexOf('Every request an app makes'));
check('activity log shows what was done and what was refused', logText.includes('Save plan version') && logText.includes('Update profile') && logText.includes('Refused: no permission') && logText.includes('Plan version 3'), logText.slice(0, 400));
check('activity log holds no amounts or labels', !logText.includes('5000000') && !logText.includes('50,000') && !logText.includes('Bonus nobody'));
const refusedOnly = txt((await get('/agents?outcome=denied')).html);
check('the log can be filtered', refusedOnly.slice(refusedOnly.indexOf('Every request an app makes')).includes('Create goal') && !refusedOnly.slice(refusedOnly.indexOf('Every request an app makes')).includes('Save plan version'));
check('the user undoes the app\'s profile change', (await submit('/agents', (f) => f.hidden.revision === String(rev), {})).includes('notice='));
check('the profile is back as it was', txt((await get('/dashboard')).html).includes('KES 120,000.00'));
check('disconnecting an app', (await submit('/agents', (f) => !!f.hidden.id && f.body.includes('Disconnect'), {})).includes('notice='));
check('the disconnected app is refused at once', (await callTool(agentToken, 'get_profile')).status === 401);
check('no app is listed as connected', txt((await get('/agents')).html).includes('No app is connected.'));

// Your data: download it.
const exported = JSON.parse((await get('/account/export')).html);
check('export contains the account, profile, plans and app history', exported.account.email === email && exported.profile.currency === 'KES' && exported.items.length === 5 && exported.planVersions.length === 3 && exported.connectedApps.length >= 1 && exported.recentAppActivity.length > 0, JSON.stringify(Object.keys(exported)));
check('export holds the real figures', exported.items.some((item) => item.label === 'Salary' && item.amountMinor === 12_000_000));

await submit('/dashboard', (f) => f.body.includes('Sign out'), {});
check('signed out', (await get('/dashboard')).url.startsWith('/sign-in'));
check('export needs a signed-in user', (await get('/account/export')).status === 401);

// Deleting the account removes everything.
await submit('/sign-in', has('email'), { email, password });
check('deleting needs the confirmation tick', (await submit('/account', has('confirm'), { password })).includes('error='));
check('deleting needs the right password', (await submit('/account', has('confirm'), { password: 'not my password', confirm: 'on' })).includes('error='));
check('account deleted', (await submit('/account', has('confirm'), { password, confirm: 'on' })).includes('have been deleted'));
check('the session is gone', (await get('/dashboard')).url.startsWith('/sign-in'));
check('the account no longer exists', (await submit('/sign-in', has('email'), { email, password })).includes('error='));
