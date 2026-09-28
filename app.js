import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PAY_METHODS = ['UPI', 'Credit card', 'Debit card', 'Cash', 'Net banking'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PLAN_MONTHS = 3; // this month + the next 2. Change to 4 to plan 3 months ahead.
const NEW_CAT_COLORS = ['#2E8B57', '#6D5BA8', '#C8553D', '#3A6EA5', '#B84A8A', '#2A9D8F', '#C98B12', '#8E5CC2', '#1F8FB5', '#A0663A'];

const S = {
  session: null, me: null,
  members: [], cats: [], txns: [], recurring: [], goals: [], contribs: [], budgets: [],
  settings: { tithe_pct: 10, savings_pct: 20 },
  tab: 'home',
  scope: localStorage.getItem('hisaab.scope') || 'household',
  period: localStorage.getItem('hisaab.period') || 'month',
  anchor: new Date(),
  actPeriod: 'month', actAnchor: new Date(), actKind: 'all', actPerson: 'all', actCat: null, q: '', actLimit: 150,
  planTab: 'budgets', planMonth: 0,
  repView: 'summary', repRange: '3m', repDays: 45,
  dirty: false,
};
let F = null; // state of whichever sheet is open

/* =================== utilities =================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const m0 = n => inr0.format(Math.round(+n || 0)).replace('-₹', '−₹');
const money = n => { n = +n || 0; return Math.abs(n - Math.round(n)) < 0.005 ? m0(n) : inr2.format(n); };
function compact(n) {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e7) return `${s}₹${+(a / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${s}₹${+(a / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${s}₹${+(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${s}₹${Math.round(a)}`;
}
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const sameDay = (a, b) => ymd(a) === ymd(b);
const ord = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const shortDate = s => { const d = parseYmd(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const firstName = m => m?.name || '';

function evalAmount(s) {
  s = String(s ?? '').replace(/,/g, '').replace(/[x×]/gi, '*').trim();
  if (!s) return NaN;
  if (!/^[\d+\-*/.() ]+$/.test(s)) return NaN;
  try {
    const v = Function('"use strict";return (' + s + ')')();
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
  } catch { return NaN; }
}

const catById = id => S.cats.find(c => c.id === id);
const memById = id => S.members.find(m => m.id === id);
const other = id => S.members.find(m => m.id !== id) || S.members[0];
const A = () => S.members[0];
const B = () => S.members[1] || S.members[0];

/* =================== periods =================== */
function periodRange(period = S.period, anchor = S.anchor) {
  const a = new Date(anchor); a.setHours(0, 0, 0, 0);
  let start, end, label;
  if (period === 'day') {
    start = a; end = addDays(a, 1);
    label = sameDay(a, today()) ? 'Today' : sameDay(a, addDays(today(), -1)) ? 'Yesterday'
      : a.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  } else if (period === 'week') {
    start = addDays(a, -((a.getDay() + 6) % 7)); end = addDays(start, 7);
    const last = addDays(end, -1);
    label = start.getMonth() === last.getMonth()
      ? `${start.getDate()}–${last.getDate()} ${MONTHS[last.getMonth()]}`
      : `${start.getDate()} ${MONTHS[start.getMonth()]} – ${last.getDate()} ${MONTHS[last.getMonth()]}`;
  } else if (period === 'month') {
    start = new Date(a.getFullYear(), a.getMonth(), 1); end = new Date(a.getFullYear(), a.getMonth() + 1, 1);
    label = start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  } else {
    start = new Date(a.getFullYear(), 0, 1); end = new Date(a.getFullYear() + 1, 0, 1);
    label = String(a.getFullYear());
  }
  return { start, end, s: ymd(start), e: ymd(end), label, period };
}
function shiftDate(period, anchor, dir) {
  const a = new Date(anchor);
  if (period === 'day') a.setDate(a.getDate() + dir);
  else if (period === 'week') a.setDate(a.getDate() + 7 * dir);
  else if (period === 'month') { a.setDate(1); a.setMonth(a.getMonth() + dir); }
  else a.setFullYear(a.getFullYear() + dir);
  return a;
}
function prevRange(r) {
  const p = periodRange(r.period, shiftDate(r.period, r.start, -1));
  const t = today();
  if (t >= r.start && t < r.end && r.period !== 'day') {
    const elapsed = Math.round((t - r.start) / 864e5) + 1;
    let pe = addDays(p.start, elapsed); if (pe > p.end) pe = p.end;
    return { ...p, end: pe, e: ymd(pe), partial: true };
  }
  return p;
}
const isCurrent = r => today() >= r.start && today() < r.end;

/* =================== money maths =================== */
function shareOf(t, mid) {
  const a = +t.amount;
  if (t.kind === 'income') return t.member_id === mid ? a : 0;
  if (t.kind === 'expense') {
    const ps = +(t.payer_share ?? 100);
    return t.member_id === mid ? a * ps / 100 : a * (100 - ps) / 100;
  }
  return 0;
}
const val = t => t.kind === 'settlement' ? 0 : (S.scope === 'household' ? +t.amount : shareOf(t, S.scope));
const inRange = (t, r) => t.txn_date >= r.s && t.txn_date < r.e;

function summarize(r) {
  let income = 0, spent = 0, tithe = 0, saved = 0; const byCat = new Map();
  for (const t of S.txns) {
    if (!inRange(t, r)) continue;
    const v = val(t); if (!v) continue;
    if (t.kind === 'income') income += v;
    else if (t.kind === 'expense') {
      const c = catById(t.category_id);
      if (c?.is_savings) { saved += v; continue; }
      spent += v;
      byCat.set(t.category_id, (byCat.get(t.category_id) || 0) + v);
      if (c?.is_tithing) tithe += v;
    }
  }
  return { income, spent, saved, balance: income - spent - saved, tithe, byCat };
}
function owes() {
  if (S.members.length < 2) return null;
  const a = A(); let n = 0; // positive: B owes A
  for (const t of S.txns) {
    const amt = +t.amount;
    if (t.kind === 'expense') {
      const o = amt * (100 - +(t.payer_share ?? 100)) / 100;
      if (o) n += t.member_id === a.id ? o : -o;
    } else if (t.kind === 'settlement') n += t.member_id === a.id ? amt : -amt;
  }
  if (Math.abs(n) < 1) return null;
  return n > 0 ? { from: B(), to: a, amount: n } : { from: a, to: B(), amount: -n };
}
function forWhomFrom(payer, ps) {
  if (ps >= 100) return { forWhom: payer, splitA: 50 };
  if (ps <= 0) return { forWhom: other(payer).id, splitA: 50 };
  return { forWhom: 'shared', splitA: payer === A().id ? ps : 100 - ps };
}
function payerShareFrom(payer, forWhom, splitA) {
  if (forWhom === 'shared') return payer === A().id ? +splitA : 100 - +splitA;
  return forWhom === payer ? 100 : 0;
}
function budgetFor(c, mk) {
  let best = null;
  for (const b of S.budgets) if (b.category_id === c.id && b.month <= mk && (!best || b.month > best.month)) best = b;
  if (best) return best.amount == null ? 0 : +best.amount;
  return +c.monthly_budget || 0;
}
const isSavingsCat = id => !!catById(id)?.is_savings;
const goalSaved = g => S.contribs.filter(c => c.goal_id === g.id).reduce((a, c) => a + +c.amount, 0);
function dueRecurring() {
  const mk = monthKey(today());
  const logged = new Set(S.txns.filter(t => t.recurring_id && t.recur_month === mk).map(t => t.recurring_id));
  return S.recurring
    .filter(r => r.active && !logged.has(r.id))
    .filter(r => S.scope === 'household' || r.member_id === S.scope || +r.payer_share < 100)
    .sort((a, b) => a.day_of_month - b.day_of_month);
}

/* =================== icons =================== */
const I = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" stroke-width="2.6"/></svg>',
  plan: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/></svg>',
  split: '<svg viewBox="0 0 24 24"><path d="M7 8h12l-3.5-3.5M17 16H5l3.5 3.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M5 20V11M11 20V5M17 20v-6M3 20h18"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

/* =================== boot & data =================== */
async function fetchAll(table, order, asc) {
  let out = [], from = 0; const size = 1000;
  for (;;) {
    const { data, error } = await sb.from(table).select('*').order(order, { ascending: asc }).range(from, from + size - 1);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < size) break;
    from += size;
  }
  return out;
}
const sortTxns = arr => arr.sort((x, y) => y.txn_date.localeCompare(x.txn_date) || (y.created_at || '').localeCompare(x.created_at || ''));

async function loadAll() {
  const [members, cats, txns, recurring, goals, contribs, settings, budgets] = await Promise.all([
    fetchAll('members', 'position', true),
    fetchAll('categories', 'sort', true),
    fetchAll('transactions', 'txn_date', false),
    fetchAll('recurring', 'day_of_month', true),
    fetchAll('goals', 'created_at', true),
    fetchAll('goal_contributions', 'contrib_date', false),
    fetchAll('settings', 'key', true),
    fetchAll('budgets', 'month', true),
  ]);
  Object.assign(S, { members, cats, txns: sortTxns(txns), recurring, goals, contribs, budgets });
  for (const s of settings) S.settings[s.key] = s.value;
}

let booting = false;
async function boot() {
  if (!S.session) { S.me = null; return renderLogin(); }
  if (booting) return;
  booting = true;
  try {
    await loadAll();
    const email = (S.session.user.email || '').toLowerCase();
    S.me = S.members.find(m => m.email.toLowerCase() === email);
    if (!S.me) return renderNotMember();
    if (S.scope !== 'household' && !memById(S.scope)) S.scope = 'household';
    subscribe();
    render();
  } catch (e) {
    console.error(e);
    if (/issued at future/i.test(e.message || '') && (boot.retries = (boot.retries || 0) + 1) <= 5) {
      booting = false;
      return setTimeout(boot, 2000);
    }
    renderError(e);
  } finally { booting = false; }
}

sb.auth.onAuthStateChange((event, session) => {
  S.session = session;
  if (event === 'TOKEN_REFRESHED' && S.me) return;
  setTimeout(boot, 0);
});

let channel = null, refreshTimer = null;
function subscribe() {
  if (channel) return;
  channel = sb.channel('hisaab-db')
    .on('postgres_changes', { event: '*', schema: 'public' }, () => {
      clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 500);
    })
    .subscribe();
}
async function refresh() {
  if (!S.me) return;
  try { await loadAll(); softRender(); } catch (e) { console.warn(e); }
}
function softRender() {
  const ae = document.activeElement;
  if (ae && $('#app').contains(ae) && ae.matches('input, select, textarea')) { S.dirty = true; return; }
  render();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
document.addEventListener('focusout', () => { if (S.dirty) setTimeout(() => { if (S.dirty) { S.dirty = false; softRender(); } }, 150); });

/* =================== screens without data =================== */
function renderLogin(msg) {
  $('#app').innerHTML = `<div class="login"><div class="login-card">
    <div class="login-cover"><div><h1>Hisaab-Kitaab</h1><p>Our household ledger. Sign in to open it.</p></div></div>
    <button class="btn primary" data-action="signin-google">Continue with Google</button>
    <p class="or">or get a sign-in link by email</p>
    <input class="inp" id="login-email" type="email" placeholder="Your email" autocomplete="email">
    <button class="btn ghost wide" data-action="signin-email">Email me a link</button>
    ${msg ? `<p class="login-msg">${esc(msg)}</p>` : ''}
  </div></div>`;
}
function renderNotMember() {
  $('#app').innerHTML = `<div class="login"><div class="login-card">
    <div class="login-cover"><div><h1>Almost there</h1><p>Signed in as ${esc(S.session.user.email)}.</p></div></div>
    <p class="login-msg">This email isn't on the household list. Add it to the <b>members</b> table in Supabase (or sign in with the email that's already there), then refresh.</p>
    <button class="btn ghost wide" data-action="signout">Sign out</button>
  </div></div>`;
}
function renderError(e) {
  $('#app').innerHTML = `<div class="login"><div class="login-card">
    <p class="login-msg">Couldn't load your data: ${esc(e.message || e)}. Check the Supabase URL and key in config.js, and that schema.sql ran without errors.</p>
    <button class="btn primary" data-action="retry">Try again</button>
    <button class="btn ghost wide" data-action="signout">Sign out</button>
  </div></div>`;
}

/* =================== main render =================== */
function render() {
  if (!S.me) return;
  if (S.tab === 'settle') S.tab = 'reports';
  const views = { home: viewHome, activity: viewActivity, plan: viewPlan, reports: viewReports };
  const titles = { home: 'Hisaab-Kitaab', activity: 'Activity', plan: 'Plan', reports: 'Reports' };
  $('#app').innerHTML = `
    <header class="topbar"><div class="topbar-in">
      <div class="brand">${S.tab === 'home' ? '<span class="mark" aria-hidden="true">₹</span>' : ''}<span>${titles[S.tab]}</span></div>
      <button class="icon-btn" data-action="settings" aria-label="Settings">${I.gear}</button>
    </div></header>
    <main class="wrap">${views[S.tab]()}</main>
    ${bottomNav()}`;
}
function bottomNav() {
  const tab = (id, label, icon) => `<button class="nav-btn ${S.tab === id ? 'on' : ''}" data-action="tab" data-tab="${id}" ${S.tab === id ? 'aria-current="page"' : ''}>${icon}<span>${label}</span></button>`;
  return `<nav class="bottomnav"><div class="bottomnav-in">
    ${tab('home', 'Home', I.home)}${tab('activity', 'Activity', I.list)}
    <button class="fab" data-action="add" aria-label="Add an entry">${I.plus}</button>
    ${tab('plan', 'Plan', I.plan)}${tab('reports', 'Reports', I.chart)}
  </div></nav>`;
}

/* ---------- home ---------- */
function scopeSwitch() {
  const opts = [{ id: 'household', name: 'Household', color: 'var(--red)' }, ...S.members];
  return `<div class="seg" role="tablist" aria-label="Whose money">${opts.map(o =>
    `<button role="tab" aria-selected="${S.scope === o.id}" class="${S.scope === o.id ? 'on' : ''}" data-action="scope" data-id="${o.id}" style="--dot:${o.color}"><i class="dot"></i>${esc(o.name)}</button>`).join('')}</div>`;
}
function periodBar(period, anchor, actionPrefix = '') {
  const r = periodRange(period, anchor);
  const seg = actionPrefix ? '' : `<div class="seg small">${['day', 'week', 'month', 'year'].map(p =>
    `<button class="${period === p ? 'on' : ''}" data-action="period" data-p="${p}">${p[0].toUpperCase() + p.slice(1)}</button>`).join('')}</div>`;
  return `<div class="period ${actionPrefix ? 'act-nav' : ''}">${seg}
    <div class="period-nav">
      <button class="icon-btn" data-action="${actionPrefix}shift" data-dir="-1" aria-label="Previous">${I.left}</button>
      ${period === 'day' || period === 'week'
        ? `<label class="period-label pickable"><span>${esc(r.label)}</span>${I.down}<input type="date" data-pick="${actionPrefix ? 'act' : 'home'}" value="${ymd(new Date(anchor))}" max="${ymd(today())}" aria-label="Choose a date"></label>`
        : `<button class="period-label" data-action="pick-period" data-target="${actionPrefix ? 'act' : 'home'}"><span>${esc(r.label)}</span>${I.down}</button>`}
      <button class="icon-btn" data-action="${actionPrefix}shift" data-dir="1" aria-label="Next" ${r.end > today() ? 'disabled' : ''}>${I.right}</button>
    </div></div>`;
}

function viewHome() {
  const r = periodRange();
  const sum = summarize(r);
  const prev = summarize(prevRange(r));
  const indiv = S.scope !== 'household';
  const showDue = isCurrent(r) && S.period !== 'year';
  return `${greeting()}${scopeSwitch()}${periodBar(S.period, S.anchor)}
    ${indiv ? `<p class="scope-note">Shared expenses count at ${esc(memById(S.scope).name)}'s share.</p>` : ''}
    ${heroCard(sum, prev, r)}
    <div class="grid2">
      ${targetCard({ title: 'Savings', pctKey: 'savings_pct', def: 20, given: sum.saved, income: sum.income, action: 'add-savings', label: 'Log savings', ring: 'save' })}
      ${targetCard({ title: 'Tithing', pctKey: 'tithe_pct', def: 10, given: sum.tithe, income: sum.income, action: 'add-tithe', label: 'Log tithing', ring: 'tithe' })}
    </div>
    ${showDue ? `<div class="grid2">${dueCard()}${goalsMini()}</div>` : ''}
    ${categoryCard(sum)}
    ${trendCard(r)}
    ${S.period === 'month' && !indiv ? budgetCard(r) : ''}
    <div class="grid2">${owesCard()}${showDue ? '' : goalsMini()}</div>
    ${recentCard(r)}`;
}
function greeting() {
  const h = new Date().getHours();
  const g = h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening';
  return `<section class="welcome"><h1>${g}, ${esc(S.me.name)}</h1><p>Your journey of saving and creating wealth, logged here.</p></section>`;
}
function heroCard(sum, prev, r) {
  const who = S.scope === 'household' ? 'Household balance' : `${memById(S.scope).name}'s balance`;
  let note = '';
  if (prev.spent > 0 && sum.spent > 0) {
    const d = sum.spent - prev.spent, p = Math.round(Math.abs(d) / prev.spent * 100);
    const base = { day: sameDay(r.start, today()) ? 'yesterday' : 'the day before', week: 'last week', month: 'last month', year: 'last year' }[r.period];
    note = p === 0 ? `Spending is level with ${base}.` : `Spending is ${p}% ${d < 0 ? 'lower' : 'higher'} than ${prevRange(r).partial ? 'at this point ' : ''}${base}.`;
  } else if (!sum.spent && !sum.income && !sum.saved) note = 'Nothing logged yet for this period. Tap + to add your first entry.';
  return `<section class="hero"><div class="hero-in">
    <div class="hero-top"><span>${esc(who)}</span><span>${esc(r.label)}</span></div>
    <div class="hero-bal">${m0(sum.balance)}</div>
    <div class="hero-row">
      <div><span class="k">Income</span><b>${compact(sum.income)}</b></div>
      <div><span class="k">Spent</span><b>${compact(sum.spent)}</b></div>
      <div><span class="k">Saved</span><b>${compact(sum.saved)}</b></div>
    </div>
    ${note ? `<p class="hero-note">${esc(note)}</p>` : ''}
  </div></section>`;
}
function targetCard({ title, pctKey, def, given, income, action, label, ring }) {
  const pct = +(S.settings[pctKey] ?? def);
  const target = income * pct / 100;
  const p = target > 0 ? Math.min(100, given / target * 100) : (given > 0 ? 100 : 0);
  const left = Math.max(0, target - given);
  const msg = target === 0
    ? (given > 0 ? 'Logged this period. Add income to see the target.' : `Log income to see your ${title.toLowerCase()} target.`)
    : left > 0.5 ? `${m0(left)} left to reach ${pct}%.` : `${pct}% target met. Beautiful.`;
  return `<section class="card"><div class="card-h"><h3>${title}</h3><span class="muted">${pct}% of income</span></div>
    <div class="tithe-body">
      <svg class="ring ${ring}" viewBox="0 0 36 36" aria-hidden="true"><circle class="bg" cx="18" cy="18" r="15.915"/>
        <circle class="fg" cx="18" cy="18" r="15.915" stroke-dasharray="${p.toFixed(1)} ${(100 - p).toFixed(1)}" stroke-dashoffset="25"/>
        <text x="18" y="21" text-anchor="middle">${Math.round(p)}%</text></svg>
      <div><div class="big">${m0(given)}</div><div class="muted small">of ${m0(target)} target</div><p class="tithe-msg">${esc(msg)}</p></div>
    </div>
    <div class="card-foot"><button class="link" data-action="${action}">${label}</button></div></section>`;
}
function dueCard() {
  const due = dueRecurring();
  const d = today().getDate();
  let body;
  if (!S.recurring.length) body = `<div class="empty">Add rent, SIPs and subscriptions once and they'll show up here every month. <button class="link" data-action="goto-plan" data-sub="recurring">Add recurring</button></div>`;
  else if (!due.length) body = `<div class="empty">All of this month's bills are logged.</div>`;
  else body = due.slice(0, 5).map(r => {
    const c = catById(r.category_id);
    const late = d > r.day_of_month, soon = r.day_of_month - d;
    const when = late ? `Was due on the ${ord(r.day_of_month)}` : soon === 0 ? 'Due today' : soon === 1 ? 'Due tomorrow' : `Due on the ${ord(r.day_of_month)}`;
    return `<div class="due"><span class="em">${c?.emoji || '🔁'}</span>
      <div><div class="t">${esc(r.name)}</div><div class="s ${late ? 'late' : ''}">${when}, ${money(r.amount)}</div></div>
      <button class="pill-btn" data-action="log-recurring" data-id="${r.id}">${r.kind === 'income' ? 'Log' : 'Pay'}</button></div>`;
  }).join('') + (due.length > 5 ? `<div class="card-foot"><button class="link" data-action="goto-plan" data-sub="recurring">${due.length - 5} more</button></div>` : '');
  return `<section class="card"><div class="card-h"><h3>Due this month</h3>${due.length ? `<span class="muted">${due.length} left</span>` : ''}</div>${body}</section>`;
}
function categoryCard(sum) {
  const entries = [...sum.byCat.entries()]
    .map(([id, v]) => ({ id, v, c: catById(id) || { name: 'Uncategorised', emoji: '•', color: '#8C8C8C' } }))
    .sort((a, b) => b.v - a.v);
  if (!entries.length) return `<section class="card"><div class="card-h"><h3>Where it went</h3></div><div class="empty">No spending in this period.</div></section>`;
  const total = sum.spent;
  let off = 25;
  const segs = entries.map(e => {
    const p = e.v / total * 100;
    const s = `<circle cx="21" cy="21" r="15.915" fill="none" stroke="${e.c.color}" stroke-width="5.2" stroke-dasharray="${p.toFixed(2)} ${(100 - p).toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"><title>${esc(e.c.name)}: ${m0(e.v)}</title></circle>`;
    off -= p; return s;
  }).join('');
  const legend = entries.map(e => {
    const p = e.v / total * 100;
    return `<button class="leg" data-action="cat-drill" data-id="${e.id || ''}" style="--c:${e.c.color}">
      <span class="em">${e.c.emoji}</span><span class="nm">${esc(e.c.name)}<small>${p < 1 ? '<1' : Math.round(p)}%</small></span><span class="am">${m0(e.v)}</span>
      <span class="bar"><i style="width:${p.toFixed(1)}%"></i></span></button>`;
  }).join('');
  return `<section class="card"><div class="card-h"><h3>Where it went</h3><span class="muted">${entries.length} categories</span></div>
    <div class="donut-wrap">
      <svg class="donut" viewBox="0 0 42 42" role="img" aria-label="Spending by category">
        <circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--soft)" stroke-width="5.2"/>${segs}
        <text x="21" y="21.5" text-anchor="middle" class="c-total">${compact(total)}</text>
        <text x="21" y="26" text-anchor="middle" class="c-lbl">spent</text></svg>
      <div class="legend">${legend}</div>
    </div></section>`;
}
function trendCard(r) {
  if (r.period === 'day') return '';
  const buckets = [];
  const tStr = ymd(today());
  if (r.period === 'year') {
    const y = r.start.getFullYear();
    for (let m = 0; m < 12; m++) buckets.push({ label: MONTHS[m][0], full: `${MONTHS[m]} ${y}`, s: ymd(new Date(y, m, 1)), e: ymd(new Date(y, m + 1, 1)), v: 0 });
  } else {
    for (let d = new Date(r.start); d < r.end; d = addDays(d, 1)) {
      buckets.push({ label: r.period === 'week' ? 'MTWTFSS'[(d.getDay() + 6) % 7] : String(d.getDate()), full: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }), s: ymd(d), e: ymd(addDays(d, 1)), v: 0 });
    }
  }
  for (const t of S.txns) {
    if (t.kind !== 'expense' || !inRange(t, r) || isSavingsCat(t.category_id)) continue;
    const v = val(t); if (!v) continue;
    const b = buckets.find(b => t.txn_date >= b.s && t.txn_date < b.e);
    if (b) b.v += v;
  }
  const W = 340, H = 150, top = 10, bottom = 22, ch = H - top - bottom, n = buckets.length;
  const gap = n > 20 ? 2.5 : n > 10 ? 5 : 10, bw = (W - gap * (n - 1)) / n;
  const max = Math.max(1, ...buckets.map(b => b.v));
  const total = buckets.reduce((a, b) => a + b.v, 0);
  const elapsed = buckets.filter(b => b.s <= tStr).length || n;
  const avg = total / elapsed;
  const showLabel = i => n <= 12 || i === 0 || (i + 1) % 5 === 0 || i === n - 1;
  let svg = '';
  buckets.forEach((b, i) => {
    const h = b.v ? Math.max(2, b.v / max * ch) : 0, x = i * (bw + gap);
    const now = tStr >= b.s && tStr < b.e;
    svg += `<g><title>${esc(b.full)}: ${m0(b.v)}</title>
      <rect x="${x.toFixed(1)}" y="${(top + ch - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, bw / 3).toFixed(1)}" class="${now ? 'now' : ''}"/>
      ${showLabel(i) ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="${b.s > tStr ? 'fut' : ''}">${b.label}</text>` : ''}</g>`;
  });
  svg += `<line class="base" x1="0" x2="${W}" y1="${top + ch}" y2="${top + ch}"/>`;
  if (avg > 0) { const y = top + ch - avg / max * ch; svg += `<line class="avg" x1="0" x2="${W}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }
  const peak = buckets.reduce((a, b) => (b.v > a.v ? b : a), buckets[0]);
  const unit = r.period === 'year' ? 'month' : 'day';
  return `<section class="card"><div class="card-h"><h3>Spending over time</h3></div>
    <svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spending by ${unit}">${svg}</svg>
    <div class="trend-foot"><span>Average <b>${m0(avg)}</b> a ${unit}</span>${peak.v ? `<span>Biggest ${unit}: <b>${esc(r.period === 'year' ? peak.full : shortDate(peak.s))}</b>, ${m0(peak.v)}</span>` : ''}</div>
  </section>`;
}
function budgetCard(r) {
  const mk = monthKey(r.start);
  const cats = S.cats.filter(c => c.kind === 'expense' && !c.archived && budgetFor(c, mk) > 0);
  if (!cats.length) return `<section class="card"><div class="card-h"><h3>Budgets</h3></div>
    <div class="empty">No monthly budgets yet. <button class="link" data-action="goto-plan" data-sub="budgets">Set budgets</button></div></section>`;
  const spent = new Map();
  for (const t of S.txns) if (t.kind === 'expense' && inRange(t, r)) spent.set(t.category_id, (spent.get(t.category_id) || 0) + +t.amount);
  const cur = isCurrent(r);
  const daysIn = Math.round((r.end - r.start) / 864e5);
  const pace = cur ? today().getDate() / daysIn * 100 : null;
  const rows = cats.map(c => ({ c, s: spent.get(c.id) || 0, b: budgetFor(c, mk) }))
    .sort((x, y) => y.s / y.b - x.s / x.b)
    .map(({ c, s, b }) => {
      const p = s / b * 100, cls = p > 100 ? 'over' : p > 85 ? 'near' : '';
      const right = p > 100 ? `${m0(s - b)} over` : `${m0(b - s)} left`;
      return `<div class="bud-item"><div class="top"><span>${c.emoji} ${esc(c.name)}</span><span class="${p > 100 ? 'over' : ''}">${right}</span></div>
        <div class="meter ${cls}"><i style="width:${Math.min(100, p).toFixed(1)}%"></i>${pace !== null ? `<span class="pace" style="left:${pace.toFixed(1)}%"></span>` : ''}</div>
        <div class="sub">${m0(s)} spent of ${m0(b)}</div></div>`;
    }).join('');
  return `<section class="card"><div class="card-h"><h3>Budgets</h3><button class="link" data-action="goto-plan" data-sub="budgets">Edit</button></div>
    <div class="bud">${rows}</div>${pace !== null ? `<p class="bud-legend">The thin line marks how far through the month you are.</p>` : ''}</section>`;
}
function owesCard() {
  const o = owes();
  return `<section class="card"><div class="card-h"><h3>Between you two</h3><button class="link" data-action="open-settle">Settle up</button></div>
    ${o ? `<div class="owe-line"><span>${esc(o.from.name)} owes ${esc(o.to.name)}</span><b>${m0(o.amount)}</b></div>`
      : `<div class="empty">All square. Nobody owes anything.</div>`}</section>`;
}
function goalsMini() {
  const goals = S.goals.filter(g => !g.archived).slice(0, 3);
  return `<section class="card"><div class="card-h"><h3>Savings goals</h3><button class="link" data-action="goto-plan" data-sub="goals">${goals.length ? 'All goals' : 'Add'}</button></div>
    ${goals.length ? goals.map(g => {
      const s = goalSaved(g), p = Math.min(100, s / +g.target * 100);
      return `<div class="bud-item" style="margin-top:10px"><div class="top"><span>${g.emoji} ${esc(g.name)}</span><span>${compact(s)} of ${compact(+g.target)}</span></div>
        <div class="meter gold"><i style="width:${p.toFixed(1)}%"></i></div></div>`;
    }).join('') : `<div class="empty">Saving for a trip, a car or an emergency fund? Add a goal and track it together.</div>`}</section>`;
}
function recentCard(r) {
  const list = S.txns.filter(t => inRange(t, r) && (S.scope === 'household' || val(t) > 0 ||
    (t.kind === 'settlement' && (t.member_id === S.scope || t.to_member_id === S.scope)))).slice(0, r.period === 'day' ? 30 : 6);
  return `<section class="card flush"><div class="card-h" style="padding-top:12px;margin-bottom:0"><h3>${r.period === 'day' ? 'Entries' : 'Latest'}</h3>
    ${list.length ? `<button class="link" data-action="see-all">See all</button>` : ''}</div>
    <div class="txns">${list.length ? list.map(t => txnRow(t, { scoped: true })).join('') : `<div class="empty" style="padding:8px 0 14px">Nothing logged in this period.</div>`}</div></section>`;
}
function txnRow(t, { scoped = false, sub, wrap = false } = {}) {
  const c = catById(t.category_id), m = memById(t.member_id);
  let icon, title, bits = [], amt, cls = t.kind, extra = '';
  if (t.kind === 'settlement') {
    icon = '⇄'; title = `${firstName(m)} paid ${firstName(memById(t.to_member_id))} back`;
    bits.push('Settlement'); if (t.payment_method) bits.push(t.payment_method);
    amt = money(t.amount);
  } else {
    icon = c?.emoji || '•'; title = t.note || c?.name || 'Uncategorised';
    if (t.note && c) bits.push(c.name);
    if (t.kind === 'income') bits.push(`${firstName(m)} earned`);
    else {
      const ps = +t.payer_share;
      bits.push(ps >= 100 ? `${firstName(m)} paid` : ps <= 0 ? `${firstName(m)} paid for ${firstName(other(t.member_id))}` : `${firstName(m)} paid, shared`);
    }
    const shown = scoped && S.scope !== 'household' ? shareOf(t, S.scope) : +t.amount;
    amt = (t.kind === 'income' ? '+' : '') + money(shown);
    if (Math.abs(shown - +t.amount) > 0.005) extra = `<small>of ${money(t.amount)}</small>`;
  }
  return `<button class="txn ${wrap ? 'wrap' : ''}" data-action="edit-txn" data-id="${t.id}">
    <span class="txn-ic" style="--c:${c?.color || '#8C8C8C'}">${icon}</span>
    <span class="txn-main"><span class="txn-t">${esc(title)}</span><span class="txn-s">${esc(sub || bits.join(', '))}</span></span>
    <span class="txn-a ${cls}">${amt}${extra}</span></button>`;
}

/* ---------- activity ---------- */
function viewActivity() {
  const people = [{ id: 'all', name: 'Both of us' }, ...S.members];
  const cat = S.actCat ? catById(S.actCat) : null;
  return `<div class="search">${I.search}<input id="act-search" type="search" placeholder="Search notes, categories or amounts" value="${esc(S.q)}" autocomplete="off"></div>
    <div class="chips scroll">${[['all', 'All'], ['expense', 'Expenses'], ['income', 'Income'], ['shared', 'Shared']].map(([v, l]) =>
      `<button class="chip ${S.actKind === v ? 'on' : ''}" data-action="act-kind" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="chips scroll">${people.map(p => `<button class="chip ${S.actPerson === p.id ? 'on' : ''}" data-action="act-person" data-v="${p.id}" ${p.color ? `style="--c:${p.color}"` : ''}>${p.color ? '<i class="dot"></i>' : ''}${esc(p.name)}</button>`).join('')}
      ${cat ? `<button class="chip on" data-action="act-clear-cat" aria-label="Remove category filter">${cat.emoji} ${esc(cat.name)} ${I.close}</button>` : ''}</div>
    <div id="act-results" style="display:flex;flex-direction:column;gap:14px">${activityResults()}</div>`;
}
function activityResults() {
  const q = S.q.trim().toLowerCase();
  const r = periodRange(S.actPeriod, S.actAnchor);
  let list = q ? S.txns : S.txns.filter(t => inRange(t, r));
  if (S.actKind === 'shared') list = list.filter(t => (t.kind === 'expense' && +t.payer_share < 100) || t.kind === 'settlement');
  else if (S.actKind !== 'all') list = list.filter(t => t.kind === S.actKind);
  const pid = S.actPerson !== 'all' ? S.actPerson : null;
  if (pid) list = list.filter(t => t.member_id === pid || t.to_member_id === pid || shareOf(t, pid) > 0);
  if (S.actCat) list = list.filter(t => t.category_id === S.actCat);
  if (q) list = list.filter(t => [t.note, catById(t.category_id)?.name, memById(t.member_id)?.name, t.payment_method, String(+t.amount)]
    .join(' ').toLowerCase().includes(q));
  let spent = 0, inc = 0, sav = 0;
  for (const t of list) {
    const v = pid ? shareOf(t, pid) : +t.amount;
    if (t.kind === 'expense') { if (isSavingsCat(t.category_id)) sav += v; else spent += v; } else if (t.kind === 'income') inc += v;
  }
  let html = '', lastDay = null;
  const dayTotals = new Map();
  for (const t of list) if (t.kind === 'expense' && !isSavingsCat(t.category_id)) dayTotals.set(t.txn_date, (dayTotals.get(t.txn_date) || 0) + (pid ? shareOf(t, pid) : +t.amount));
  for (const t of list.slice(0, S.actLimit)) {
    if (t.txn_date !== lastDay) {
      lastDay = t.txn_date;
      const d = parseYmd(t.txn_date);
      const lbl = sameDay(d, today()) ? 'Today' : sameDay(d, addDays(today(), -1)) ? 'Yesterday' : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() !== today().getFullYear() ? 'numeric' : undefined });
      html += `<div class="dayhead"><span>${lbl}</span><span>${dayTotals.get(t.txn_date) ? m0(dayTotals.get(t.txn_date)) + ' spent' : ''}</span></div>`;
    }
    html += txnRow(t, { sub: undefined });
  }
  return `${q ? `<p class="muted small" style="margin:0">${list.length} match${list.length === 1 ? '' : 'es'} across all dates</p>` : periodBar(S.actPeriod, S.actAnchor, 'act-')}
    <div class="act-tot"><div><span class="muted">Income</span><b class="inc">${m0(inc)}</b></div><div><span class="muted">Spent</span><b>${m0(spent)}</b></div><div><span class="muted">Saved</span><b>${m0(sav)}</b></div></div>
    <section class="card flush"><div class="txns">${html || `<div class="empty" style="padding:14px 0">${q ? 'No entries match that search.' : 'Nothing logged here yet. Tap + to add an entry.'}</div>`}</div></section>
    ${list.length > S.actLimit ? `<button class="btn-add" data-action="act-more">Show more</button>` : ''}`;
}
function renderActResults() { const el = $('#act-results'); if (el) el.innerHTML = activityResults(); }

/* ---------- plan ---------- */
function viewPlan() {
  const tabs = [['budgets', 'Budgets'], ['recurring', 'Recurring'], ['goals', 'Goals']];
  return `<div class="seg">${tabs.map(([v, l]) => `<button class="${S.planTab === v ? 'on' : ''}" data-action="plan" data-v="${v}">${l}</button>`).join('')}</div>
    ${S.planTab === 'goals' ? '' : planMonthSeg()}
    ${{ budgets: planBudgets, recurring: planRecurring, goals: planGoals }[S.planTab]()}`;
}
function planMonthDate() { const t = today(); return new Date(t.getFullYear(), t.getMonth() + S.planMonth, 1); }
function planMonthSeg() {
  const t = today(); let h = '';
  for (let i = 0; i < PLAN_MONTHS; i++) {
    const d = new Date(t.getFullYear(), t.getMonth() + i, 1);
    const lbl = d.toLocaleDateString('en-IN', { month: 'long' }) + (d.getFullYear() !== t.getFullYear() ? ` ${d.getFullYear()}` : '');
    h += `<button class="${S.planMonth === i ? 'on' : ''}" data-action="plan-month" data-i="${i}">${lbl}</button>`;
  }
  return `<div class="seg small" role="tablist" aria-label="Month to plan">${h}</div>`;
}
function planBudgets() {
  const pm = planMonthDate(), mk = monthKey(pm), r = periodRange('month', pm), cur = S.planMonth === 0;
  const t = today();
  const hs = ymd(new Date(t.getFullYear(), t.getMonth() - 3, 1)), he = ymd(new Date(t.getFullYear(), t.getMonth(), 1));
  const spent = new Map(), hist = new Map();
  for (const x of S.txns) {
    if (x.kind !== 'expense') continue;
    if (cur && inRange(x, r)) spent.set(x.category_id, (spent.get(x.category_id) || 0) + +x.amount);
    if (x.txn_date >= hs && x.txn_date < he) hist.set(x.category_id, (hist.get(x.category_id) || 0) + +x.amount);
  }
  const cats = S.cats.filter(c => c.kind === 'expense' && !c.archived);
  const budgeted = cats.map(c => ({ c, b: budgetFor(c, mk) })).filter(x => x.b > 0);
  const tb = budgeted.reduce((a, x) => a + x.b, 0), ts = budgeted.reduce((a, x) => a + (spent.get(x.c.id) || 0), 0);
  const act = S.recurring.filter(x => x.active);
  const bills = act.filter(x => x.kind === 'expense').reduce((a, x) => a + +x.amount, 0);
  const regInc = act.filter(x => x.kind === 'income').reduce((a, x) => a + +x.amount, 0);
  const p = tb ? ts / tb * 100 : 0;
  const top = cur
    ? (tb ? `<div class="bud-item"><div class="top"><span>${m0(ts)} spent</span><span>of ${m0(tb)} budgeted</span></div>
        <div class="meter ${p > 100 ? 'over' : p > 85 ? 'near' : ''}"><i style="width:${Math.min(100, p).toFixed(1)}%"></i></div></div>`
      : `<div class="empty">Set a monthly limit for any category below. The 3-month average helps you pick a realistic number.</div>`)
    : `<div class="two"><div><div class="muted small">Budgeted</div><div class="big">${m0(tb)}</div></div>
        <div><div class="muted small">Fixed bills</div><div class="big">${m0(bills)}</div></div></div>
        ${regInc ? `<p class="muted small" style="margin:10px 0 0">Expected regular income ${m0(regInc)}. At your targets that's ${m0(regInc * (+(S.settings.savings_pct ?? 20)) / 100)} to save and ${m0(regInc * (+(S.settings.tithe_pct ?? 10)) / 100)} to tithe.</p>` : ''}`;
  return `<section class="card"><div class="card-h"><h3>${esc(r.label)}</h3><span class="muted">${cur ? 'This month' : 'Planning ahead'}</span></div>${top}</section>
    <section class="card">${cats.map(c => {
      const avg = (hist.get(c.id) || 0) / 3, s = spent.get(c.id) || 0, b = budgetFor(c, mk);
      const note = cur ? `${m0(s)} this month${avg ? `, avg ${m0(avg)}` : ''}` : (avg ? `3-month avg ${m0(avg)}` : 'No recent spending');
      return `<div class="bud-row"><span class="em">${c.emoji}</span>
        <div class="nm"><b>${esc(c.name)}</b><small>${note}</small></div>
        <label class="money-in">₹<input inputmode="numeric" data-budget="${c.id}" data-month="${mk}" value="${b ? Math.round(b) : ''}" placeholder="No limit" aria-label="${esc(r.label)} budget for ${esc(c.name)}"></label></div>`;
    }).join('')}</section>
    <p class="muted small" style="margin:0 2px">Budgets carry forward to later months until you change them.</p>`;
}
function planRecurring() {
  const pm = planMonthDate(), mk = monthKey(pm), cur = S.planMonth === 0;
  const dim = new Date(pm.getFullYear(), pm.getMonth() + 1, 0).getDate();
  const logged = new Set(S.txns.filter(t => t.recurring_id && t.recur_month === mk).map(t => t.recurring_id));
  const act = S.recurring.filter(r => r.active);
  const out = act.filter(r => r.kind === 'expense').reduce((a, r) => a + +r.amount, 0);
  const inc = act.filter(r => r.kind === 'income').reduce((a, r) => a + +r.amount, 0);
  const rows = S.recurring.map(r => {
    const c = catById(r.category_id), m = memById(r.member_id);
    const ps = +r.payer_share;
    const whose = ps >= 100 ? '' : ps <= 0 ? `, for ${firstName(other(r.member_id))}` : ', shared';
    const status = !r.active ? '<small class="muted">Paused</small>'
      : cur ? (logged.has(r.id) ? '<small class="ok">Logged</small>' : '<small class="warn">Due</small>')
      : `<small class="muted">${Math.min(r.day_of_month, dim)} ${MONTHS[pm.getMonth()]}</small>`;
    return `<button class="row-btn" data-action="edit-recurring" data-id="${r.id}"><span class="em">${c?.emoji || '🔁'}</span>
      <span><span class="t">${esc(r.name)}</span><span class="s">${ord(r.day_of_month)} of every month, ${firstName(m)}${r.kind === 'income' ? ' earns' : ' pays'}${whose}</span></span>
      <span class="r ${r.kind === 'income' ? 'ok' : ''}">${money(r.amount)}${status}</span></button>`;
  }).join('');
  return `${S.recurring.length ? `<section class="card"><div class="two">
      <div><div class="muted small">Fixed outflows</div><div class="big">${m0(out)}</div></div>
      <div><div class="muted small">Regular income</div><div class="big" style="color:var(--green)">${m0(inc)}</div></div></div></section>` : ''}
    <section class="card">${rows || `<div class="empty">Rent, SIPs, EMIs, subscriptions, salary: add them once and they'll appear on Home each month with a one-tap Pay button.</div>`}</section>
    <button class="btn-add" data-action="new-recurring">Add recurring item</button>`;
}
function monthsUntil(s) { const t = today(), d = parseYmd(s); return (d.getFullYear() - t.getFullYear()) * 12 + d.getMonth() - t.getMonth() + (d.getDate() >= t.getDate() ? 0 : -1); }
function planGoals() {
  const goals = S.goals.filter(g => !g.archived);
  const rows = goals.map(g => {
    const saved = goalSaved(g), target = +g.target, p = Math.min(100, saved / target * 100);
    let plan = '';
    if (saved >= target) plan = 'Goal reached';
    else if (g.target_date) {
      const mo = Math.max(1, monthsUntil(g.target_date));
      plan = `${m0((target - saved) / mo)} a month to reach it by ${MONTHS[parseYmd(g.target_date).getMonth()]} ${parseYmd(g.target_date).getFullYear()}`;
    } else plan = `${m0(target - saved)} to go`;
    return `<div class="goal"><button class="goal-main" data-action="edit-goal" data-id="${g.id}"><span class="em">${g.emoji}</span>
        <span><b>${esc(g.name)}</b><small>${g.member_id ? esc(memById(g.member_id)?.name) + "'s goal" : 'Household goal'}</small></span></button>
      <div class="goal-nums"><b>${m0(saved)}</b> of ${m0(target)}</div>
      <div class="meter gold"><i style="width:${p.toFixed(1)}%"></i></div>
      <div class="goal-f"><span class="muted">${esc(plan)}</span><button class="pill-btn" data-action="goal-add" data-id="${g.id}">Add money</button></div></div>`;
  }).join('');
  return `<section class="card">${rows || `<div class="empty">An emergency fund, a trip, a new car: set a target and a date and Hisaab works out how much to put aside each month.</div>`}</section>
    <button class="btn-add" data-action="new-goal">New savings goal</button>`;
}


/* ---------- reports ---------- */
const REP_RANGES = [['this', 'This month'], ['3m', '3 months'], ['6m', '6 months'], ['fy', 'This FY']];
function repMonths() {
  const t = today();
  let n = { this: 1, '3m': 3, '6m': 6 }[S.repRange];
  if (S.repRange === 'fy') { const fy = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1; n = (t.getFullYear() - fy) * 12 + t.getMonth() - 3 + 1; }
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(t.getFullYear(), t.getMonth() - i, 1);
    out.push({ d, key: monthKey(d), s: ymd(d), e: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 1)), label: `${MONTHS[d.getMonth()]} ’${String(d.getFullYear()).slice(2)}` });
  }
  return out; // oldest first
}
function statsFor(s, e, scope) {
  const r = { inc: 0, sp: 0, sv: 0, ti: 0, paid: 0, cats: new Map() };
  for (const t of S.txns) {
    if (t.txn_date < s || t.txn_date >= e || t.kind === 'settlement') continue;
    if (scope !== 'household' && t.kind === 'expense' && t.member_id === scope) r.paid += +t.amount;
    const v = scope === 'household' ? +t.amount : shareOf(t, scope);
    if (!v) continue;
    if (t.kind === 'income') { r.inc += v; continue; }
    const c = catById(t.category_id);
    if (c?.is_savings) r.sv += v; else { r.sp += v; if (c?.is_tithing) r.ti += v; }
    r.cats.set(t.category_id, (r.cats.get(t.category_id) || 0) + v);
  }
  r.bal = r.inc - r.sp - r.sv;
  return r;
}
const pctOf = (a, b) => b > 0 ? `${Math.round(a / b * 100)}%` : '–';

function viewReports() {
  const views = [['summary', 'Summary'], ['daily', 'Daily'], ['categories', 'Categories'], ['compare', 'Compare']];
  return `<div class="seg small">${views.map(([v, l]) => `<button class="${S.repView === v ? 'on' : ''}" data-action="rep-view" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="chips scroll">${REP_RANGES.map(([v, l]) => `<button class="chip ${S.repRange === v ? 'on' : ''}" data-action="rep-range" data-v="${v}">${l}</button>`).join('')}</div>
    ${S.repView === 'compare' ? '' : scopeSwitch()}
    ${{ summary: repSummary, daily: repDaily, categories: repCategories, compare: repCompare }[S.repView]()}`;
}
function tiles(items) {
  return `<div class="tiles">${items.map(([k, v, sub, cls]) => `<div class="tile"><span>${k}</span><b class="${cls || ''}">${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`).join('')}</div>`;
}
function repSummary() {
  const months = repMonths(), rows = months.map(m => ({ m, st: statsFor(m.s, m.e, S.scope) }));
  const tot = rows.reduce((a, { st }) => ({ inc: a.inc + st.inc, sp: a.sp + st.sp, sv: a.sv + st.sv, ti: a.ti + st.ti, bal: a.bal + st.bal }), { inc: 0, sp: 0, sv: 0, ti: 0, bal: 0 });
  const n = rows.length;
  const W = 340, H = 160, top = 10, bottom = 22, ch = H - top - bottom, gw = W / n, bw = Math.min(14, gw * 0.24);
  const max = Math.max(1, ...rows.flatMap(({ st }) => [st.inc, st.sp, st.sv]));
  let svg = '';
  rows.forEach(({ m, st }, i) => {
    const x0 = i * gw + gw / 2 - 1.5 * bw - 2;
    [['inc', st.inc, 'Income'], ['sp', st.sp, 'Spent'], ['sv', st.sv, 'Saved']].forEach(([cls, v, name], j) => {
      const h = v ? Math.max(2, v / max * ch) : 0;
      svg += `<rect class="${cls}" x="${(x0 + j * (bw + 2)).toFixed(1)}" y="${(top + ch - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${m.label} ${name}: ${m0(v)}</title></rect>`;
    });
    if (n <= 6 || i % 2 === 0 || i === n - 1) svg += `<text x="${(i * gw + gw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${MONTHS[m.d.getMonth()]}</text>`;
  });
  svg += `<line class="base" x1="0" x2="${W}" y1="${top + ch}" y2="${top + ch}"/>`;
  const body = [...rows].reverse().map(({ m, st }) => `<tr data-action="rep-month" data-m="${m.key}"><th>${m.label}</th><td class="inc">${m0(st.inc)}</td><td>${m0(st.sp)}</td><td>${m0(st.sv)}</td><td>${m0(st.ti)}</td><td class="${st.bal < 0 ? 'neg' : ''}">${m0(st.bal)}</td><td>${pctOf(st.sv, st.inc)}</td></tr>`).join('');
  return `${tiles([
      ['Income', m0(tot.inc), n > 1 ? `avg ${m0(tot.inc / n)} a month` : '', 'inc'],
      ['Spent', m0(tot.sp), n > 1 ? `avg ${m0(tot.sp / n)} a month` : ''],
      ['Saved', m0(tot.sv), `${pctOf(tot.sv, tot.inc)} of income (target ${+(S.settings.savings_pct ?? 20)}%)`],
      ['Tithed', m0(tot.ti), `${pctOf(tot.ti, tot.inc)} of income (target ${+(S.settings.tithe_pct ?? 10)}%)`],
    ])}
    ${n > 1 ? `<section class="card"><div class="card-h"><h3>Month by month</h3></div>
      <svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="Income, spending and savings by month">${svg}</svg>
      <div class="legend-row"><span><i class="dot" style="--dot:var(--green)"></i>Income</span><span><i class="dot" style="--dot:var(--red)"></i>Spent</span><span><i class="dot" style="--dot:var(--gold)"></i>Saved</span></div></section>` : ''}
    <section class="card flush"><div class="rtable-wrap"><table class="rtable">
      <thead><tr><th>Month</th><th>Income</th><th>Spent</th><th>Saved</th><th>Tithed</th><th>Left over</th><th>Save %</th></tr></thead>
      <tbody>${body}</tbody>
      ${n > 1 ? `<tfoot><tr><th>Total</th><td class="inc">${m0(tot.inc)}</td><td>${m0(tot.sp)}</td><td>${m0(tot.sv)}</td><td>${m0(tot.ti)}</td><td class="${tot.bal < 0 ? 'neg' : ''}">${m0(tot.bal)}</td><td>${pctOf(tot.sv, tot.inc)}</td></tr></tfoot>` : ''}
    </table></div></section>
    <p class="muted small" style="margin:0 2px">Tap a month to open it on Home.</p>`;
}
function repDaily() {
  const months = repMonths(), s = months[0].s, e = ymd(addDays(today(), 1));
  const days = new Map();
  for (const t of S.txns) {
    if (t.txn_date < s || t.txn_date >= e) continue;
    const v = val(t);
    const inScope = S.scope === 'household' || v > 0 || (t.kind === 'settlement' && (t.member_id === S.scope || t.to_member_id === S.scope));
    if (!inScope) continue;
    if (!days.has(t.txn_date)) days.set(t.txn_date, { list: [], inc: 0, out: 0, sv: 0 });
    const d = days.get(t.txn_date); d.list.push(t);
    if (t.kind === 'income') d.inc += v;
    else if (t.kind === 'expense') { if (isSavingsCat(t.category_id)) d.sv += v; else d.out += v; }
  }
  const elapsed = Math.round((today() - parseYmd(s)) / 864e5) + 1;
  let total = 0, peak = null, spendDays = 0;
  for (const [k, d] of days) { total += d.out; if (d.out > 0) spendDays++; if (!peak || d.out > peak.v) peak = { k, v: d.out }; }
  const keys = [...days.keys()].sort().reverse();
  const shown = keys.filter(k => k >= ymd(addDays(today(), -S.repDays)));
  const html = shown.map(k => {
    const d = days.get(k), dt = parseYmd(k);
    const lbl = sameDay(dt, today()) ? 'Today' : sameDay(dt, addDays(today(), -1)) ? 'Yesterday' : dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    const parts = [d.out ? `${m0(d.out)} spent` : '', d.sv ? `${m0(d.sv)} saved` : '', d.inc ? `+${m0(d.inc)} in` : ''].filter(Boolean).join(', ');
    return `<div class="dayhead"><span>${lbl}</span><span>${parts}</span></div>${d.list.map(t => txnRow(t, { scoped: true })).join('')}`;
  }).join('');
  return `${tiles([
      ['Average a day', m0(total / elapsed), `over ${elapsed} days`],
      ['Biggest day', peak && peak.v ? m0(peak.v) : '–', peak && peak.v ? shortDate(peak.k) : ''],
      ['No-spend days', String(Math.max(0, elapsed - spendDays)), `of ${elapsed}`],
      ['Entries', String([...days.values()].reduce((a, d) => a + d.list.length, 0)), ''],
    ])}
    <section class="card flush"><div class="txns">${html || `<div class="empty" style="padding:14px 0">Nothing logged in this period.</div>`}</div></section>
    ${keys.length > shown.length ? `<button class="btn-add" data-action="rep-more">Show earlier days</button>` : ''}`;
}
function repCategories() {
  const months = repMonths(), per = months.map(m => statsFor(m.s, m.e, S.scope));
  const ids = new Set(); per.forEach(p => p.cats.forEach((v, id) => { const c = catById(id); if (!c || c.kind === 'expense') ids.add(id); }));
  const rows = [...ids].map(id => ({ id, c: catById(id) || { name: 'Uncategorised', emoji: '•' }, vals: per.map(p => p.cats.get(id) || 0) }))
    .map(r => ({ ...r, tot: r.vals.reduce((a, b) => a + b, 0) })).sort((a, b) => b.tot - a.tot);
  if (!rows.length) return `<section class="card"><div class="empty">No spending in this period.</div></section>`;
  const two = months.length > 1;
  const change = vals => {
    const cur = vals[vals.length - 1], prev = vals[vals.length - 2];
    if (!prev && !cur) return '<td class="muted">–</td>';
    if (!prev) return '<td class="up">New</td>';
    const p = Math.round((cur - prev) / prev * 100);
    return `<td class="${p > 0 ? 'up' : p < 0 ? 'down' : 'muted'}">${p > 0 ? '▲' : p < 0 ? '▼' : ''} ${Math.abs(p)}%</td>`;
  };
  const colTot = months.map((_, i) => rows.reduce((a, r) => a + r.vals[i], 0));
  return `<section class="card flush"><div class="rtable-wrap"><table class="rtable">
      <thead><tr><th>Category</th>${months.map(m => `<th>${m.label}</th>`).join('')}${two ? '<th>vs last month</th>' : ''}${two ? '<th>Total</th>' : ''}</tr></thead>
      <tbody>${rows.map(r => `<tr><th>${r.c.emoji} ${esc(r.c.name)}</th>${r.vals.map(v => `<td>${v ? m0(v) : '<span class="muted">–</span>'}</td>`).join('')}${two ? change(r.vals) : ''}${two ? `<td><b>${m0(r.tot)}</b></td>` : ''}</tr>`).join('')}</tbody>
      <tfoot><tr><th>All categories</th>${colTot.map(v => `<td>${m0(v)}</td>`).join('')}${two ? change(colTot) : ''}${two ? `<td>${m0(colTot.reduce((a, b) => a + b, 0))}</td>` : ''}</tr></tfoot>
    </table></div></section>
    <p class="muted small" style="margin:0 2px">${two ? `"vs last month" compares ${months[months.length - 1].label} (so far) with ${months[months.length - 2].label}. ▲ means more spending. ` : ''}Includes savings and tithing.</p>`;
}
function repCompare() {
  const months = repMonths(), s = months[0].s, e = months[months.length - 1].e;
  const a = A(), b = B(), sa = statsFor(s, e, a.id), sb2 = statsFor(s, e, b.id);
  const top = st => [...st.cats.entries()].filter(([id]) => catById(id)?.kind === 'expense' && !catById(id)?.is_savings)
    .sort((x, y) => y[1] - x[1]).slice(0, 3).map(([id, v]) => `${catById(id).emoji} ${esc(catById(id).name)} <span class="muted">${compact(v)}</span>`).join('<br>') || '<span class="muted">–</span>';
  const row = (k, fa, fb, cls = '') => `<tr><th>${k}</th><td class="${cls}">${fa}</td><td class="${cls}">${fb}</td></tr>`;
  const monthRows = [...months].reverse().map(m => {
    const x = statsFor(m.s, m.e, a.id), y = statsFor(m.s, m.e, b.id);
    return `<tr><th>${m.label}</th><td>${m0(x.sp)}</td><td>${m0(y.sp)}</td><td>${m0(x.sv)}</td><td>${m0(y.sv)}</td></tr>`;
  }).join('');
  return `<section class="card flush"><div class="rtable-wrap"><table class="rtable compare">
      <thead><tr><th></th><th><i class="dot" style="--dot:${a.color}"></i> ${esc(a.name)}</th><th><i class="dot" style="--dot:${b.color}"></i> ${esc(b.name)}</th></tr></thead>
      <tbody>
        ${row('Income', m0(sa.inc), m0(sb2.inc), 'inc')}
        ${row('Spent (own share)', m0(sa.sp), m0(sb2.sp))}
        ${row('Saved', m0(sa.sv), m0(sb2.sv))}
        ${row('Savings rate', pctOf(sa.sv, sa.inc), pctOf(sb2.sv, sb2.inc))}
        ${row('Tithed', m0(sa.ti), m0(sb2.ti))}
        ${row('Tithing rate', pctOf(sa.ti, sa.inc), pctOf(sb2.ti, sb2.inc))}
        ${row('Left over', m0(sa.bal), m0(sb2.bal))}
        ${row('Actually paid out', m0(sa.paid), m0(sb2.paid))}
        <tr><th>Top spending</th><td class="left">${top(sa)}</td><td class="left">${top(sb2)}</td></tr>
      </tbody></table></div></section>
    <p class="muted small" style="margin:0 2px">"Spent" counts each person's share of shared expenses. "Actually paid out" is what each of you paid in full, before splitting.</p>
    ${months.length > 1 ? `<section class="card flush"><div class="card-h" style="padding-top:12px;margin-bottom:4px"><h3>By month</h3></div><div class="rtable-wrap"><table class="rtable">
      <thead><tr><th>Month</th><th>${esc(a.name)} spent</th><th>${esc(b.name)} spent</th><th>${esc(a.name)} saved</th><th>${esc(b.name)} saved</th></tr></thead>
      <tbody>${monthRows}</tbody></table></div></section>` : ''}`;
}

/* ---------- settle ---------- */
function viewSettle() {
  const o = owes();
  const list = S.txns.filter(t => (t.kind === 'expense' && +t.payer_share < 100) || t.kind === 'settlement').slice(0, 100);
  return `<section class="settle-hero">
      ${o ? `<div class="muted">${esc(o.from.name)} owes ${esc(o.to.name)}</div><div class="owe-big">${m0(o.amount)}</div>`
        : `<div class="owe-big">All square</div><div class="muted">Nobody owes anything right now.</div>`}
      <button class="btn primary" data-action="settle-new">${o ? `Record ${esc(o.from.name)}'s payment` : 'Record a payment'}</button></section>
    <p class="muted small" style="margin:0 2px">Anything marked Shared or paid for the other person adds up here. When one of you pays the other back, record it so the balance resets.</p>
    <section class="card flush"><div class="card-h" style="padding-top:12px;margin-bottom:0"><h3>Shared history</h3></div><div class="txns">
      ${list.length ? list.map(t => {
        if (t.kind === 'settlement') return txnRow(t);
        const owed = +t.amount * (100 - +t.payer_share) / 100, o2 = other(t.member_id);
        return txnRow(t, { sub: `${shortDate(t.txn_date)}: ${firstName(memById(t.member_id))} paid, ${firstName(o2)}'s part ${money(owed)}`, wrap: true });
      }).join('') : `<div class="empty" style="padding:8px 0 14px">When you mark an expense as Shared, it shows up here.</div>`}
    </div></section>`;
}

/* =================== sheets =================== */
function openSheet(renderFn, state) {
  F = state;
  F.render = () => { const c = $('#sheet-root .sheet-content'); if (c) { c.innerHTML = renderFn(); afterSheet(false); } };
  const root = $('#sheet-root');
  root.innerHTML = `<div class="backdrop" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true"><div class="grab" aria-hidden="true"></div><div class="sheet-content">${renderFn()}</div></div>`;
  root.classList.add('open');
  document.body.classList.add('noscroll');
  afterSheet(true);
}
function afterSheet(first) {
  const a = $('#f-amount');
  if (a) { sizeAmount(a); if (first && !F.id && F.autofocus !== false) a.focus({ preventScroll: true }); }
}
function closeSheet() {
  const root = $('#sheet-root');
  root.classList.remove('open'); root.innerHTML = '';
  document.body.classList.remove('noscroll');
  F = null;
}
function sizeAmount(el) {
  el.style.width = Math.max(2, (el.value || '0').length + 0.4) + 'ch';
  const hint = $('#f-hint');
  if (hint) { const v = evalAmount(el.value); hint.textContent = /[+\-*/x×]/i.test(el.value.replace(/^-/, '')) && v ? `= ${money(v)}` : ''; }
}
const chip = (g, v, label, on, color) =>
  `<button type="button" class="chip ${on ? 'on' : ''}" data-action="chip" data-g="${g}" data-v="${esc(v)}" ${color ? `style="--c:${color}"` : ''}>${color ? '<i class="dot"></i>' : ''}${esc(label)}</button>`;
const sheetHead = (title, extra = '') => `<div class="sheet-h">${title}${extra}<button class="icon-btn" data-action="close-sheet" aria-label="Close">${I.close}</button></div>`;
function dateField(label = 'Date') {
  const t = ymd(today()), y = ymd(addDays(today(), -1));
  const otherDate = F.date !== t && F.date !== y;
  return `<div><div class="flabel">${label}</div><div class="chips">
    ${chip('date', t, 'Today', F.date === t)}${chip('date', y, 'Yesterday', F.date === y)}
    <label class="chip datepick ${otherDate ? 'on' : ''}" id="f-datepick"><span>${otherDate ? shortDate(F.date) : 'Pick a date'}</span><input type="date" id="f-date" value="${F.date}" aria-label="Pick a date"></label></div></div>`;
}
function amountField(isInc) {
  return `<div><label class="amount ${isInc ? 'inc' : ''}"><span>₹</span><input id="f-amount" data-f="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(F.amount)}" aria-label="Amount"></label>
    <div class="amount-hint" id="f-hint"></div></div>`;
}
function whoseField() {
  const a = A(), b = B();
  return `<div><div class="flabel">Whose expense is it?</div><div class="chips">
      ${chip('forWhom', a.id, 'For ' + a.name, F.forWhom === a.id)}${chip('forWhom', 'shared', 'Shared', F.forWhom === 'shared')}${chip('forWhom', b.id, 'For ' + b.name, F.forWhom === b.id)}</div>
    <div class="split ${F.forWhom === 'shared' ? '' : 'hidden'}" id="f-split">
      <input type="range" min="0" max="100" step="5" value="${F.splitA}" data-f="splitA" aria-label="${esc(a.name)}'s share">
      <div class="split-l" id="f-split-l">${esc(a.name)} ${F.splitA}%, ${esc(b.name)} ${100 - F.splitA}%</div></div></div>`;
}

/* ---------- add / edit entry ---------- */
function orderedCats(kind) {
  const since = ymd(addDays(today(), -120)), freq = new Map();
  for (const t of S.txns) {
    if (t.txn_date < since) break;
    if (t.kind === kind && t.category_id) freq.set(t.category_id, (freq.get(t.category_id) || 0) + (t.member_id === S.me.id ? 2 : 1));
  }
  return S.cats.filter(c => c.kind === kind && !c.archived).sort((a, b) => (freq.get(b.id) || 0) - (freq.get(a.id) || 0) || a.sort - b.sort);
}
function openTxnSheet({ txn, recurring, kind, category_id } = {}) {
  const src = txn || recurring;
  const payer = src?.member_id || S.me.id;
  const fw = forWhomFrom(payer, src ? +(src.payer_share ?? 100) : 100);
  openSheet(txnSheetHTML, {
    mode: 'txn', id: txn?.id || null,
    kind: src?.kind || kind || 'expense',
    amount: src ? String(+src.amount) : '',
    category_id: src?.category_id || category_id || null,
    payer, forWhom: fw.forWhom, splitA: fw.splitA, forWhomTouched: !!src,
    pm: src?.payment_method || localStorage.getItem('hisaab.pm') || 'UPI',
    date: txn?.txn_date || ymd(today()),
    note: txn ? (txn.note || '') : (recurring ? recurring.name : ''),
    recurring_id: txn?.recurring_id || recurring?.id || null,
    recur_month: txn?.recur_month || (recurring ? monthKey(today()) : null),
    showAll: false, autofocus: !recurring,
  });
}
function txnSheetHTML() {
  const isInc = F.kind === 'income';
  const cats = orderedCats(F.kind);
  let shown = F.showAll ? cats : cats.slice(0, 11);
  if (F.category_id && !shown.some(c => c.id === F.category_id)) { const sel = catById(F.category_id); if (sel) shown = [sel, ...shown.slice(0, 10)]; }
  const seg = `<div class="seg">
    <button class="${!isInc ? 'on' : ''}" data-action="chip" data-g="kind" data-v="expense">Expense</button>
    <button class="${isInc ? 'on' : ''}" data-action="chip" data-g="kind" data-v="income">Income</button></div>`;
  return `${sheetHead(F.id ? `<h2>Edit entry</h2>` : seg)}
  <div class="sheet-body">
    ${F.id ? seg : ''}
    ${amountField(isInc)}
    <div><div class="flabel">Category</div><div class="catgrid">
      ${shown.map(c => `<button type="button" class="cat ${F.category_id === c.id ? 'on' : ''}" data-action="f-cat" data-id="${c.id}" style="--c:${c.color}"><span>${c.emoji}</span><small>${esc(c.name)}</small></button>`).join('')}
      ${cats.length > shown.length ? `<button type="button" class="cat" data-action="f-morecats"><span>⋯</span><small>All ${cats.length}</small></button>` : ''}</div></div>
    <div><div class="flabel">${isInc ? 'Earned by' : 'Paid by'}</div><div class="chips">${S.members.map(m => chip('payer', m.id, m.name, F.payer === m.id, m.color)).join('')}</div></div>
    ${isInc ? '' : whoseField()}
    ${isInc ? '' : `<div><div class="flabel">Paid with</div><div class="chips">${PAY_METHODS.map(p => chip('pm', p, p, F.pm === p)).join('')}</div></div>`}
    ${dateField()}
    <div><input class="inp" data-f="note" placeholder="Note (optional)" value="${esc(F.note)}" maxlength="120" enterkeyhint="done"></div>
  </div>
  <div class="sheet-foot">${F.id ? `<button class="btn ghost danger" data-action="f-delete">Delete</button>` : ''}
    <button class="btn primary" data-action="f-save">${F.id ? 'Save changes' : isInc ? 'Add income' : 'Add expense'}</button></div>`;
}
async function saveTxn(btn) {
  const amount = evalAmount(F.amount);
  if (!(amount > 0)) { toast('Enter an amount above zero'); $('#f-amount')?.focus(); return; }
  if (!F.category_id) return toast('Pick a category');
  const row = {
    kind: F.kind, amount, txn_date: F.date, category_id: F.category_id, member_id: F.payer,
    payer_share: F.kind === 'expense' ? payerShareFrom(F.payer, F.forWhom, F.splitA) : 100,
    payment_method: F.kind === 'expense' ? F.pm : null,
    note: F.note.trim() || null,
    recurring_id: F.recurring_id, recur_month: F.recurring_id ? F.recur_month : null,
  };
  btn.disabled = true;
  const editing = F.id;
  const { data, error } = editing
    ? await sb.from('transactions').update(row).eq('id', editing).select().single()
    : await sb.from('transactions').insert(row).select().single();
  btn.disabled = false;
  if (error) return toast(error.code === '23505' ? 'That bill is already logged for this month' : `Couldn't save: ${error.message}`);
  if (F.kind === 'expense') localStorage.setItem('hisaab.pm', F.pm);
  upsertLocal('txns', data);
  closeSheet(); render();
  const c = catById(data.category_id);
  toast(`${editing ? 'Updated' : 'Saved'} ${money(data.amount)}, ${c?.name || ''}`, editing ? null : {
    label: 'Undo', fn: async () => { await sb.from('transactions').delete().eq('id', data.id); removeLocal('txns', data.id); render(); toast('Removed'); },
  });
}
async function deleteById(table, key, id, label = 'Deleted') {
  if (!confirm('Delete this for both of you? This can’t be undone.')) return false;
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) { toast(`Couldn't delete: ${error.message}`); return false; }
  removeLocal(key, id); closeSheet(); render(); toast(label); return true;
}
function upsertLocal(key, row) {
  const arr = S[key], i = arr.findIndex(x => x.id === row.id);
  if (i >= 0) arr[i] = row; else arr.unshift(row);
  if (key === 'txns') sortTxns(arr);
}
function removeLocal(key, id) { S[key] = S[key].filter(x => x.id !== id); }

/* ---------- settlement ---------- */
function openSettleSheet(t) {
  const o = owes();
  openSheet(settleHTML, {
    mode: 'settle', id: t?.id || null,
    payer: t?.member_id || o?.from.id || S.me.id,
    amount: t ? String(+t.amount) : (o ? String(Math.round(o.amount)) : ''),
    pm: t?.payment_method || 'UPI', date: t?.txn_date || ymd(today()), note: t?.note || '', autofocus: !o,
  });
}
function settleHTML() {
  const to = other(F.payer);
  return `${sheetHead(`<h2>${F.id ? 'Edit settlement' : 'Record a settlement'}</h2>`)}
  <div class="sheet-body">
    <div><div class="flabel">Who paid the other back?</div><div class="chips">${S.members.map(m => chip('payer', m.id, m.name, F.payer === m.id, m.color)).join('')}</div>
      <p class="muted small" style="margin:8px 0 0">${esc(F.payer ? memById(F.payer).name : '')} pays ${esc(to.name)}</p></div>
    ${amountField(false)}
    <div><div class="flabel">Paid with</div><div class="chips">${PAY_METHODS.map(p => chip('pm', p, p, F.pm === p)).join('')}</div></div>
    ${dateField()}
    <div><input class="inp" data-f="note" placeholder="Note (optional)" value="${esc(F.note)}"></div>
  </div>
  <div class="sheet-foot">${F.id ? `<button class="btn ghost danger" data-action="s-delete">Delete</button>` : ''}<button class="btn primary" data-action="s-save">${F.id ? 'Save changes' : 'Record settlement'}</button></div>`;
}
async function saveSettle(btn) {
  const amount = evalAmount(F.amount);
  if (!(amount > 0)) return toast('Enter an amount above zero');
  const row = { kind: 'settlement', amount, txn_date: F.date, member_id: F.payer, to_member_id: other(F.payer).id, payer_share: 100, payment_method: F.pm, note: F.note.trim() || null, category_id: null };
  btn.disabled = true;
  const { data, error } = F.id ? await sb.from('transactions').update(row).eq('id', F.id).select().single() : await sb.from('transactions').insert(row).select().single();
  btn.disabled = false;
  if (error) return toast(`Couldn't save: ${error.message}`);
  upsertLocal('txns', data); closeSheet(); render(); toast('Settlement recorded');
}

/* ---------- recurring ---------- */
function openRecurringSheet(r) {
  const payer = r?.member_id || S.me.id;
  const fw = forWhomFrom(payer, r ? +r.payer_share : 100);
  openSheet(recurringHTML, {
    mode: 'recurring', id: r?.id || null, name: r?.name || '', kind: r?.kind || 'expense',
    amount: r ? String(+r.amount) : '', category_id: r?.category_id || '',
    payer, forWhom: fw.forWhom, splitA: fw.splitA, pm: r?.payment_method || 'UPI',
    day: String(r?.day_of_month || today().getDate()), active: r ? (r.active ? 'yes' : 'no') : 'yes', autofocus: false,
  });
}
function recurringHTML() {
  const isInc = F.kind === 'income';
  const cats = S.cats.filter(c => c.kind === F.kind && !c.archived);
  return `${sheetHead(`<h2>${F.id ? 'Edit recurring' : 'New recurring item'}</h2>`)}
  <div class="sheet-body">
    <div class="chips">${chip('kind', 'expense', 'Bill or payment', !isInc)}${chip('kind', 'income', 'Income', isInc)}</div>
    <div><div class="flabel">Name</div><input class="inp" data-f="name" value="${esc(F.name)}" placeholder="${isInc ? 'e.g. Salary' : 'e.g. Rent, Netflix, Mutual fund SIP'}"></div>
    ${amountField(isInc)}
    <div class="two">
      <div><div class="flabel">Category</div><select class="inp" data-f="category_id"><option value="">Choose</option>${cats.map(c => `<option value="${c.id}" ${F.category_id === c.id ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('')}</select></div>
      <div><div class="flabel">Day of month</div><input class="inp" data-f="day" type="number" min="1" max="31" inputmode="numeric" value="${esc(F.day)}"></div>
    </div>
    <div><div class="flabel">${isInc ? 'Earned by' : 'Paid by'}</div><div class="chips">${S.members.map(m => chip('payer', m.id, m.name, F.payer === m.id, m.color)).join('')}</div></div>
    ${isInc ? '' : whoseField()}
    ${isInc ? '' : `<div><div class="flabel">Paid with</div><div class="chips">${PAY_METHODS.map(p => chip('pm', p, p, F.pm === p)).join('')}</div></div>`}
    ${F.id ? `<div><div class="flabel">Status</div><div class="chips">${chip('active', 'yes', 'Active', F.active === 'yes')}${chip('active', 'no', 'Paused', F.active === 'no')}</div></div>` : ''}
  </div>
  <div class="sheet-foot">${F.id ? `<button class="btn ghost danger" data-action="r-delete">Delete</button>` : ''}<button class="btn primary" data-action="r-save">${F.id ? 'Save changes' : 'Add recurring item'}</button></div>`;
}
async function saveRecurring(btn) {
  const amount = evalAmount(F.amount), day = parseInt(F.day, 10);
  if (!F.name.trim()) return toast('Give it a name');
  if (!(amount > 0)) return toast('Enter an amount above zero');
  if (!F.category_id) return toast('Pick a category');
  if (!(day >= 1 && day <= 31)) return toast('Day of month must be 1 to 31');
  const row = {
    name: F.name.trim(), kind: F.kind, amount, category_id: F.category_id, member_id: F.payer,
    payer_share: F.kind === 'expense' ? payerShareFrom(F.payer, F.forWhom, F.splitA) : 100,
    payment_method: F.kind === 'expense' ? F.pm : null, day_of_month: day, active: F.active !== 'no',
  };
  btn.disabled = true;
  const isNew = !F.id;
  const { data, error } = F.id ? await sb.from('recurring').update(row).eq('id', F.id).select().single() : await sb.from('recurring').insert(row).select().single();
  btn.disabled = false;
  if (error) return toast(`Couldn't save: ${error.message}`);
  upsertLocal('recurring', data); S.recurring.sort((a, b) => a.day_of_month - b.day_of_month);
  closeSheet(); render(); toast(isNew ? `Saved. It'll show on Home each month.` : 'Updated');
}

/* ---------- goals ---------- */
function openGoalSheet(g) {
  openSheet(goalHTML, { mode: 'goal', id: g?.id || null, name: g?.name || '', emoji: g?.emoji || '🎯', amount: g ? String(+g.target) : '', target_date: g?.target_date || '', owner: g?.member_id || 'household', autofocus: false });
}
function goalHTML() {
  return `${sheetHead(`<h2>${F.id ? 'Edit goal' : 'New savings goal'}</h2>`)}
  <div class="sheet-body">
    <div><div class="flabel">Goal</div><div class="cat-row"><input class="inp emoji" data-f="emoji" value="${esc(F.emoji)}" maxlength="4" aria-label="Emoji"><input class="inp" data-f="name" value="${esc(F.name)}" placeholder="e.g. Emergency fund, Bali trip"></div></div>
    <div><div class="flabel">Target amount</div>${amountField(false)}</div>
    <div><div class="flabel">Reach it by (optional)</div><input class="inp" type="date" data-f="target_date" value="${esc(F.target_date)}"></div>
    <div><div class="flabel">Whose goal</div><div class="chips">${chip('owner', 'household', 'Household', F.owner === 'household')}${S.members.map(m => chip('owner', m.id, m.name, F.owner === m.id, m.color)).join('')}</div></div>
  </div>
  <div class="sheet-foot">${F.id ? `<button class="btn ghost danger" data-action="g-delete">Delete</button>` : ''}<button class="btn primary" data-action="g-save">${F.id ? 'Save changes' : 'Create goal'}</button></div>`;
}
async function saveGoal(btn) {
  const target = evalAmount(F.amount);
  if (!F.name.trim()) return toast('Give the goal a name');
  if (!(target > 0)) return toast('Enter a target above zero');
  const row = { name: F.name.trim(), emoji: F.emoji.trim() || '🎯', target, target_date: F.target_date || null, member_id: F.owner === 'household' ? null : F.owner };
  btn.disabled = true;
  const { data, error } = F.id ? await sb.from('goals').update(row).eq('id', F.id).select().single() : await sb.from('goals').insert(row).select().single();
  btn.disabled = false;
  if (error) return toast(`Couldn't save: ${error.message}`);
  const isNew = !F.id;
  upsertLocal('goals', data); closeSheet(); render(); toast(isNew ? 'Goal created' : 'Goal updated');
}
function openContribSheet(g) {
  openSheet(contribHTML, { mode: 'contrib', goal: g, dir: 'add', amount: '', payer: S.me.id, date: ymd(today()), note: '' });
}
function contribHTML() {
  return `${sheetHead(`<h2>${F.goal.emoji} ${esc(F.goal.name)}</h2>`)}
  <div class="sheet-body">
    <div class="chips">${chip('dir', 'add', 'Add money', F.dir === 'add')}${chip('dir', 'withdraw', 'Take money out', F.dir === 'withdraw')}</div>
    ${amountField(F.dir === 'add')}
    <div><div class="flabel">Who</div><div class="chips">${S.members.map(m => chip('payer', m.id, m.name, F.payer === m.id, m.color)).join('')}</div></div>
    ${dateField()}
    <div><input class="inp" data-f="note" placeholder="Note (optional)" value="${esc(F.note)}"></div>
    <p class="muted small" style="margin:0">Tip: if this money comes out of your monthly spending, also log it as an expense under Investments & SIPs so your balance stays accurate.</p>
  </div>
  <div class="sheet-foot"><button class="btn primary" data-action="c-save">${F.dir === 'add' ? 'Add to goal' : 'Take out'}</button></div>`;
}
async function saveContrib(btn) {
  const amt = evalAmount(F.amount);
  if (!(amt > 0)) return toast('Enter an amount above zero');
  btn.disabled = true;
  const { data, error } = await sb.from('goal_contributions').insert({ goal_id: F.goal.id, member_id: F.payer, amount: F.dir === 'withdraw' ? -amt : amt, contrib_date: F.date, note: F.note.trim() || null }).select().single();
  btn.disabled = false;
  if (error) return toast(`Couldn't save: ${error.message}`);
  S.contribs.unshift(data); const g = F.goal; closeSheet(); render();
  toast(`${goalSaved(g) >= +g.target ? 'Goal reached! ' : ''}${m0(goalSaved(g))} saved for ${g.name}`);
}

/* ---------- settings ---------- */
function openSettingsSheet() { openSheet(settingsHTML, { mode: 'settings', autofocus: false }); }
function settingsHTML() {
  const catRows = kind => S.cats.filter(c => c.kind === kind).map(c => `<div class="cat-row ${c.archived ? 'arch' : ''}">
      <input class="inp emoji" data-cat-field="emoji" data-id="${c.id}" value="${esc(c.emoji)}" maxlength="4" aria-label="Emoji for ${esc(c.name)}">
      <input class="inp" data-cat-field="name" data-id="${c.id}" value="${esc(c.name)}" aria-label="Category name">
      <button class="link" data-action="cat-archive" data-id="${c.id}">${c.archived ? 'Restore' : 'Hide'}</button></div>`).join('');
  return `${sheetHead('<h2>Settings</h2>')}
  <div class="sheet-body">
    <div class="set-block"><div class="flabel">Signed in</div><div>${esc(S.me.name)}, ${esc(S.session.user.email)}</div></div>
    <div class="set-block"><div class="flabel">Savings target</div>
      <label class="inline"><input class="inp" inputmode="numeric" data-setting="savings_pct" value="${esc(S.settings.savings_pct ?? 20)}"> % of income</label>
      <p class="muted small" style="margin:0">Counts anything logged under ${esc(S.cats.filter(c => c.is_savings && !c.archived).map(c => c.name).join(' or ') || 'a savings category')}.</p></div>
    <div class="set-block"><div class="flabel">Tithing target</div>
      <label class="inline"><input class="inp" inputmode="numeric" data-setting="tithe_pct" value="${esc(S.settings.tithe_pct ?? 10)}"> % of income</label></div>
    <div class="set-block"><div class="flabel">Expense categories</div>${catRows('expense')}</div>
    <div class="set-block"><div class="flabel">Income categories</div>${catRows('income')}</div>
    <div class="set-block"><div class="flabel">Add a category</div>
      <div class="cat-row"><input class="inp emoji" id="nc-emoji" value="🏷️" maxlength="4" aria-label="Emoji"><input class="inp" id="nc-name" placeholder="Category name"></div>
      <div class="cat-row"><select class="inp" id="nc-kind"><option value="expense">Expense</option><option value="income">Income</option></select>
        <button class="btn primary" data-action="cat-add" style="flex:0 0 auto">Add</button></div></div>
    <div class="set-block"><div class="flabel">Your data</div>
      <button class="btn ghost wide" data-action="export">Download all entries (CSV)</button>
      <button class="btn ghost wide danger" data-action="signout">Sign out</button></div>
  </div>`;
}
function exportCSV() {
  const a = A(), b = B();
  const rows = [['Date', 'Type', 'Amount', 'Category', 'Paid / earned by', `${a.name} share`, `${b.name} share`, 'Paid to', 'Method', 'Note']];
  for (const t of [...S.txns].reverse()) {
    rows.push([t.txn_date, t.kind, +t.amount, catById(t.category_id)?.name || '', memById(t.member_id)?.name || '',
      t.kind === 'settlement' ? '' : shareOf(t, a.id).toFixed(2), t.kind === 'settlement' ? '' : shareOf(t, b.id).toFixed(2),
      memById(t.to_member_id)?.name || '', t.payment_method || '', t.note || '']);
  }
  const csv = rows.map(r => r.map(v => { v = String(v ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `hisaab-${ymd(today())}.csv` });
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- month / year picker ---------- */
function openPicker(target) {
  const period = target === 'act' ? S.actPeriod : S.period;
  const anchor = new Date(target === 'act' ? S.actAnchor : S.anchor);
  openSheet(pickerHTML, { mode: 'pick', target, period, year: anchor.getFullYear(), sel: anchor, autofocus: false });
}
function pickerHTML() {
  const t = today(), cy = t.getFullYear(), cm = t.getMonth();
  if (F.period === 'year') {
    const earliest = S.txns.length ? +S.txns[S.txns.length - 1].txn_date.slice(0, 4) : cy;
    const years = []; for (let y = cy; y >= Math.min(earliest, cy - 2); y--) years.push(y);
    return `${sheetHead('<h2>Choose a year</h2>')}<div class="sheet-body"><div class="mgrid">
      ${years.map(y => `<button class="mbtn ${F.sel.getFullYear() === y ? 'on' : ''}" data-action="pick-year" data-y="${y}">${y}</button>`).join('')}</div></div>
      <div class="sheet-foot"><button class="btn primary" data-action="pick-now">This year</button></div>`;
  }
  return `${sheetHead('<h2>Choose a month</h2>')}<div class="sheet-body">
    <div class="period-nav" style="justify-content:center">
      <button class="icon-btn" data-action="pick-yshift" data-dir="-1" aria-label="Previous year">${I.left}</button>
      <span class="period-label">${F.year}</span>
      <button class="icon-btn" data-action="pick-yshift" data-dir="1" aria-label="Next year" ${F.year >= cy ? 'disabled' : ''}>${I.right}</button></div>
    <div class="mgrid">${MONTHS.map((m, i) => {
      const future = F.year > cy || (F.year === cy && i > cm);
      const on = F.sel.getFullYear() === F.year && F.sel.getMonth() === i;
      return `<button class="mbtn ${on ? 'on' : ''}" data-action="pick-month" data-m="${i}" ${future ? 'disabled' : ''}>${m}</button>`;
    }).join('')}</div></div>
    <div class="sheet-foot"><button class="btn primary" data-action="pick-now">This month</button></div>`;
}
function applyPick(d) {
  if (F.target === 'act') { S.actAnchor = d; S.actLimit = 150; } else S.anchor = d;
  closeSheet(); render();
}

/* =================== toast =================== */
let toastTimer, toastFn = null;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button data-action="toast-act">${esc(action.label)}</button>` : ''}`;
  toastFn = action?.fn || null;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5500 : 2600);
}

/* =================== events =================== */
const actions = {
  tab: el => { S.tab = el.dataset.tab; closeSheet(); window.scrollTo(0, 0); render(); },
  scope: el => { S.scope = el.dataset.id; localStorage.setItem('hisaab.scope', S.scope); render(); },
  period: el => { S.period = el.dataset.p; localStorage.setItem('hisaab.period', S.period); S.anchor = new Date(); render(); },
  shift: el => { S.anchor = shiftDate(S.period, S.anchor, +el.dataset.dir); render(); },
  now: () => { S.anchor = new Date(); render(); },
  'act-shift': el => { S.actAnchor = shiftDate(S.actPeriod, S.actAnchor, +el.dataset.dir); S.actLimit = 150; renderActResults(); },
  'act-now': () => { S.actPeriod = 'month'; S.actAnchor = new Date(); renderActResults(); },
  'act-kind': el => { S.actKind = el.dataset.v; render(); },
  'act-person': el => { S.actPerson = el.dataset.v; render(); },
  'act-clear-cat': () => { S.actCat = null; render(); },
  'act-more': () => { S.actLimit += 150; renderActResults(); },
  'cat-drill': el => {
    S.actCat = el.dataset.id || null; S.actPeriod = S.period; S.actAnchor = new Date(S.anchor);
    S.actKind = 'all'; S.q = ''; S.actPerson = S.scope === 'household' ? 'all' : S.scope; S.tab = 'activity'; window.scrollTo(0, 0); render();
  },
  'see-all': () => { S.actCat = null; S.actPeriod = S.period; S.actAnchor = new Date(S.anchor); S.actPerson = S.scope === 'household' ? 'all' : S.scope; S.tab = 'activity'; window.scrollTo(0, 0); render(); },
  add: () => openTxnSheet({}),
  'add-savings': () => openTxnSheet({ kind: 'expense', category_id: (S.cats.find(c => c.is_savings && !c.archived && c.name === 'Savings') || S.cats.find(c => c.is_savings && !c.archived))?.id }),
  'plan-month': el => { S.planMonth = +el.dataset.i; render(); },
  'pick-period': el => openPicker(el.dataset.target),
  'pick-yshift': el => { F.year += +el.dataset.dir; F.render(); },
  'pick-month': el => applyPick(new Date(F.year, +el.dataset.m, 1)),
  'pick-year': el => applyPick(+el.dataset.y === today().getFullYear() ? new Date() : new Date(+el.dataset.y, 0, 1)),
  'pick-now': () => applyPick(new Date()),
  'add-tithe': () => openTxnSheet({ kind: 'expense', category_id: S.cats.find(c => c.is_tithing && !c.archived)?.id }),
  'edit-txn': el => { const t = S.txns.find(x => x.id === el.dataset.id); if (t) t.kind === 'settlement' ? openSettleSheet(t) : openTxnSheet({ txn: t }); },
  'log-recurring': el => { const r = S.recurring.find(x => x.id === el.dataset.id); if (r) openTxnSheet({ recurring: r }); },
  'close-sheet': closeSheet,
  chip: el => chipClick(el),
  'f-cat': el => {
    F.category_id = el.dataset.id;
    $$('.cat').forEach(b => b.classList.toggle('on', b.dataset.id === F.category_id));
    if (!F.id && !F.forWhomTouched && F.kind === 'expense') {
      const last = S.txns.find(t => t.kind === 'expense' && t.category_id === F.category_id);
      const wantShared = last && +last.payer_share > 0 && +last.payer_share < 100;
      const next = wantShared ? 'shared' : F.payer;
      if (next !== F.forWhom || (wantShared && last)) {
        F.forWhom = next;
        if (wantShared) F.splitA = last.member_id === A().id ? +last.payer_share : 100 - +last.payer_share;
        F.render();
      }
    }
  },
  'f-morecats': () => { F.showAll = true; F.render(); },
  'f-save': el => saveTxn(el),
  'f-delete': () => deleteById('transactions', 'txns', F.id),
  's-save': el => saveSettle(el),
  's-delete': () => deleteById('transactions', 'txns', F.id),
  settings: () => openSettingsSheet(),
  plan: el => { S.planTab = el.dataset.v; render(); },
  'goto-plan': el => { S.tab = 'plan'; S.planTab = el.dataset.sub || 'budgets'; window.scrollTo(0, 0); render(); },
  'new-recurring': () => openRecurringSheet(null),
  'edit-recurring': el => openRecurringSheet(S.recurring.find(r => r.id === el.dataset.id)),
  'r-save': el => saveRecurring(el),
  'r-delete': () => deleteById('recurring', 'recurring', F.id, 'Recurring item deleted'),
  'new-goal': () => openGoalSheet(null),
  'edit-goal': el => openGoalSheet(S.goals.find(g => g.id === el.dataset.id)),
  'g-save': el => saveGoal(el),
  'g-delete': () => deleteById('goals', 'goals', F.id, 'Goal deleted'),
  'goal-add': el => openContribSheet(S.goals.find(g => g.id === el.dataset.id)),
  'c-save': el => saveContrib(el),
  'settle-new': () => openSettleSheet(null),
  'open-settle': () => openSheet(() => `${sheetHead('<h2>Settle up</h2>')}<div class="sheet-body">${viewSettle()}</div>`, { mode: 'settleview', autofocus: false }),
  'rep-view': el => { S.repView = el.dataset.v; S.repDays = 45; render(); },
  'rep-range': el => { S.repRange = el.dataset.v; S.repDays = 45; render(); },
  'rep-more': () => { S.repDays += 60; render(); },
  'rep-month': el => { S.period = 'month'; S.anchor = parseYmd(el.dataset.m + '-01'); S.tab = 'home'; window.scrollTo(0, 0); render(); },
  'toast-act': () => { $('#toast').classList.remove('show'); toastFn?.(); toastFn = null; },
  'cat-archive': async el => {
    const c = catById(el.dataset.id); if (!c) return;
    const { error } = await sb.from('categories').update({ archived: !c.archived }).eq('id', c.id);
    if (error) return toast(error.message);
    c.archived = !c.archived; F.render(); render();
  },
  'cat-add': async () => {
    const name = $('#nc-name').value.trim(); if (!name) return toast('Type a category name');
    const kind = $('#nc-kind').value;
    const row = { name, kind, emoji: $('#nc-emoji').value.trim() || '🏷️', color: NEW_CAT_COLORS[S.cats.length % NEW_CAT_COLORS.length], sort: 200 };
    const { data, error } = await sb.from('categories').insert(row).select().single();
    if (error) return toast(error.message);
    S.cats.push(data); F.render(); render(); toast(`Added ${name}`);
  },
  export: () => exportCSV(),
  retry: () => boot(),
  signout: async () => { await sb.auth.signOut(); if (channel) sb.removeChannel(channel); localStorage.removeItem('hisaab.scope'); location.reload(); },
  'signin-google': async () => {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
    if (error) renderLogin(error.message);
  },
  'signin-email': async el => {
    const email = $('#login-email').value.trim(); if (!email) return renderLogin('Type your email first.');
    el.disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    renderLogin(error ? error.message : `Check ${email} for a sign-in link. Open it on this device.`);
  },
};

function chipClick(el) {
  const g = el.dataset.g, v = el.dataset.v;
  if (g === 'kind' && F.mode === 'txn' && catById(F.category_id)?.kind !== v) { F.category_id = null; F.showAll = false; }
  if (g === 'kind' && F.mode === 'recurring' && catById(F.category_id)?.kind !== v) F.category_id = '';
  F[g] = v;
  if (g === 'forWhom') F.forWhomTouched = true;
  if (F.mode !== 'txn' || g === 'kind' || (g === 'payer' && !F.forWhomTouched && F.forWhom !== 'shared')) {
    if (g === 'payer' && F.mode === 'txn') F.forWhom = v;
    return F.render();
  }
  el.parentElement.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === el));
  if (g === 'forWhom') $('#f-split')?.classList.toggle('hidden', v !== 'shared');
  if (g === 'date') { const dp = $('#f-datepick'); if (dp) dp.querySelector('span').textContent = 'Pick a date'; }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'act-search') { S.q = el.value; S.actLimit = 150; renderActResults(); return; }
  if (F && el.dataset.f) {
    F[el.dataset.f] = el.value;
    if (el.id === 'f-amount') sizeAmount(el);
    if (el.dataset.f === 'splitA') { F.splitA = +el.value; const l = $('#f-split-l'); if (l) l.textContent = `${A().name} ${F.splitA}%, ${B().name} ${100 - F.splitA}%`; }
  }
});
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.pick) {
    if (!el.value) return;
    const d = parseYmd(el.value);
    if (el.dataset.pick === 'act') { S.actAnchor = d; S.actLimit = 150; renderActResults(); } else { S.anchor = d; render(); }
    return;
  }
  if (el.id === 'f-date' && F) {
    F.date = el.value || ymd(today());
    const dp = $('#f-datepick');
    dp.parentElement.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === dp));
    dp.querySelector('span').textContent = shortDate(F.date);
    return;
  }
  if (el.dataset.budget) {
    const raw = el.value.replace(/[^\d.]/g, ''), v = raw === '' ? null : +raw;
    const c = catById(el.dataset.budget), month = el.dataset.month;
    const { data, error } = await sb.from('budgets')
      .upsert({ category_id: c.id, month, amount: v, updated_at: new Date().toISOString() }, { onConflict: 'category_id,month' })
      .select().single();
    if (error) return toast(error.message);
    S.budgets = S.budgets.filter(b => !(b.category_id === c.id && b.month === month)).concat(data);
    const ml = parseYmd(month + '-01').toLocaleDateString('en-IN', { month: 'long' });
    toast(v ? `${c.name}: ${m0(v)} from ${ml}` : `No limit for ${c.name} from ${ml}`);
    return;
  }
  if (el.dataset.catField) {
    const c = catById(el.dataset.id), field = el.dataset.catField, value = el.value.trim();
    if (!value) { el.value = c[field]; return; }
    const { error } = await sb.from('categories').update({ [field]: value }).eq('id', c.id);
    if (error) return toast(error.message);
    c[field] = value; render(); toast('Category updated');
    return;
  }
  if (el.dataset.setting) {
    const key = el.dataset.setting, v = Math.max(0, Math.min(100, parseFloat(el.value) || 0));
    const { error } = await sb.from('settings').upsert({ key, value: v, updated_at: new Date().toISOString() });
    if (error) return toast(error.message);
    S.settings[key] = v; el.value = v; render();
    toast(`${key === 'tithe_pct' ? 'Tithing' : 'Savings'} target set to ${v}%`);
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && F) closeSheet();
  if (e.key === 'Enter' && F && e.target.matches('.sheet input:not([type=date])')) {
    e.preventDefault();
    $('.sheet-foot .btn.primary')?.click();
  }
});
