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
  for (const [k, v] of Object.entries({ ...form.hidden, ...fields })) data.append(k, v);
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

await submit('/dashboard', (f) => f.body.includes('Sign out'), {});
check('signed out', (await get('/dashboard')).url.startsWith('/sign-in'));
