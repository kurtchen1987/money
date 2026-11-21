'use strict';
/* 錢錢管家：資料只存在這支手機的瀏覽器裡（localStorage），程式本身不含任何個人金額。 */

// ---------- 小工具 ----------
const KEY = 'money.v1', CAL_KEY = 'money.cal';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (n < 0 ? '-' : '') + Math.abs(Math.round(n || 0)).toLocaleString('en-US');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sum = (arr, f = x => x) => arr.reduce((a, x) => a + (+f(x) || 0), 0);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ymd(d); };
const dow = s => pd(s).getDay();
const WK = '日一二三四五六';
const md = s => { const d = pd(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const mdw = s => `${md(s)}（${WK[dow(s)]}）`;
const diff = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
const mk = (y, m) => `${y}-${pad(m)}`;
const nextMonth = (k, n = 1) => { let [y, m] = k.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return mk(y, m); };
const dim = (y, m) => new Date(y, m, 0).getDate();
const dateIn = (k, day) => { const [y, m] = k.split('-').map(Number); return `${k}-${pad(Math.min(day, dim(y, m)))}`; };
const params = new URLSearchParams(location.search);
let TODAY = params.get('today') || ymd(new Date());
const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('⚠️ 存檔失敗，請先匯出備份'); return false; } };

const KINDS = { income: '收入', expense: '支出', invest: '投資', transfer: '互轉' };
const COLORS = ['#2f6f5e', '#3b6fb6', '#b7791f', '#c8463d', '#7a5ea8', '#4a9a9a', '#9aa3ad'];

// ---------- 預設設定（通用，不含個人資料） ----------
function defaultConfig() {
  return {
    version: 1,
    startDate: TODAY,
    accounts: [
      { id: 'cash', name: '現金錢包', type: 'cash' },
      { id: 'bank1', name: '薪轉銀行', type: 'bank' }
    ],
    salary: { day: 14, to: 'bank1', remindDay: 11 },
    savings: 'bank1',
    rules: [],
    cards: [],
    checks: [],
    dca: [],
    categories: [
      { name: '餐飲', emoji: '🍱' }, { name: '交通', emoji: '🚌' }, { name: '運動', emoji: '🏋️' }, { name: '生活', emoji: '🧴' },
      { name: '娛樂', emoji: '🎮' }, { name: '家庭', emoji: '🏠' }, { name: '醫療', emoji: '💊' }, { name: '其他', emoji: '📦' }
    ],
    jars: [
      { id: 'j1', name: '緊急預備金', emoji: '🛟', color: '#2f6f5e', target: 0, targetDate: '' },
      { id: 'j2', name: '旅遊', emoji: '✈️', color: '#3b6fb6', target: 0, targetDate: '' },
      { id: 'j3', name: '自由目標', emoji: '🎯', color: '#b7791f', target: 0, targetDate: '' }
    ],
    reconDay: 0
  };
}
const SYS_CATS = { '家用': '🏠', '定期定額': '📈', '共用基金': '🤝', '未記錄小額': '🪙', '卡費': '💳', '薪水': '💰', '差旅': '🧳', '其他收入': '💵' };

let S = load(KEY);
let C, D;
function bind() { C = S.config; D = S.data; D.tx ||= []; D.periods ||= {}; D.bills ||= {}; D.recon ||= {}; }
function save() { store(KEY, S); }
function fresh(config) { S = { config, data: { tx: [], periods: {}, bills: {}, recon: {}, lastExport: null } }; bind(); save(); }

// ---------- 台灣上班日曆 ----------
let CAL = load(CAL_KEY) || {};
function fixedHolidays(y) {
  // 下載失敗時的備案：週末＋固定日期國定假日（週六提前到週五、週日延到週一）
  const out = new Set();
  for (const x of ['01-01', '02-28', '04-04', '05-01', '09-28', '10-10', '10-25', '12-25']) {
    const s = `${y}-${x}`, w = dow(s);
    out.add(w === 6 ? addDays(s, -1) : w === 0 ? addDays(s, 1) : s);
  }
  return out;
}
function isOff(s) {
  const y = s.slice(0, 4), c = CAL[y], w = dow(s);
  if (c) { if (c.h.includes(s)) return true; if (c.w.includes(s)) return false; return w === 0 || w === 6; }
  if (w === 0 || w === 6) return true;
  return fixedHolidays(+y).has(s);
}
function shiftDate(s, mode) {
  let n = 0;
  if (mode === 'before') while (isOff(s) && n++ < 20) s = addDays(s, -1);
  else if (mode === 'after') while (isOff(s) && n++ < 20) s = addDays(s, 1);
  return s;
}
async function refreshCal(force) {
  const ty = +TODAY.slice(0, 4);
  let changed = false;
  for (const y of [ty, ty + 1]) {
    if (CAL[y] && !force) continue;
    try {
      const r = await fetch(`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${y}.json`, { cache: 'no-store' });
      if (!r.ok) continue;
      const j = await r.json();
      if (!Array.isArray(j) || !j.length) continue;
      const toS = x => `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}`;
      const h = [], w = [];
      for (const e of j) {
        const s = toS(String(e.date)), we = e.week === '六' || e.week === '日';
        if (e.isHoliday && !we) h.push(s);
        if (!e.isHoliday && we) w.push(s);
      }
      CAL[y] = { h, w, at: TODAY }; changed = true;
    } catch (e) { /* 沒網路就用備案 */ }
  }
  if (changed) { store(CAL_KEY, CAL); render(); }
  return changed;
}

// ---------- 帳戶 ----------
const acc = id => C.accounts.find(a => a.id === id) || { id, name: id || '—', type: 'ext' };
const accName = id => acc(id).name;
const cardOf = id => C.cards.find(c => c.id === id);
function balances(upTo = TODAY) {
  const b = {};
  for (const a of C.accounts) b[a.id] = 0;
  const add = (id, v) => { if (id in b) b[id] += v; };
  for (const t of D.tx) {
    if (t.date > upTo) continue;
    const a = +t.amount || 0;
    if (t.kind === 'income') add(t.to, a);
    else if (t.kind === 'expense' || t.kind === 'invest') add(t.from, -a);
    else if (t.kind === 'transfer') { add(t.from, -a); add(t.to, a); }
    else if (t.kind === 'adjust') add(t.to, a);
    else if (t.kind === 'jar' && !t.noAcct) add(C.savings, -a); // 罐子＝分割帳戶：存進去從主帳戶扣，拿回來加回主帳戶
  }
  return b;
}
function jarBalances() {
  const b = {};
  for (const j of C.jars) b[j.id] = 0;
  for (const t of D.tx) if (t.kind === 'jar' && t.jar in b) b[t.jar] += +t.amount || 0;
  return b;
}

// ---------- 發薪週期 ----------
function payday(k) { const p = D.periods[k]; if (p && p.payDate) return p.payDate; return shiftDate(dateIn(k, C.salary.day), 'before'); }
function periodOf(s) {
  let k = s.slice(0, 7);
  if (s < payday(k)) k = nextMonth(k, -1);
  else if (s >= payday(nextMonth(k))) k = nextMonth(k);
  return k;
}
function range(k) { return { start: payday(k), end: addDays(payday(nextMonth(k)), -1) }; }
// 每個「幾號」在一期裡只出現一次：大於等於發薪日的算當月，小於的算下個月
const occ = (k, day) => day >= C.salary.day ? dateIn(k, day) : dateIn(nextMonth(k), day);
const txByRef = ref => D.tx.find(t => t.ref === ref);
const periodOfTx = t => t.ref ? t.ref.split('|')[0] : periodOf(t.date);

function plan(k) {
  const items = [], { start } = range(k), P = D.periods[k] || {};
  items.push({ key: `${k}|salary`, date: start, title: '薪水入帳', kind: 'income', to: C.salary.to, category: '薪水', amount: P.salary ?? null, auto: true, need: 'salary', grp: 'payday' });
  for (const r of C.rules) {
    if (r.enabled === false) continue;
    const date = r.when === 'payday' ? start : r.when === 'payday+1' ? addDays(start, 1) : shiftDate(occ(k, +r.day), r.shift || 'none');
    items.push({ key: `${k}|r|${r.id}`, date, title: r.name, kind: r.kind, from: r.from, to: r.to, category: r.category, amount: r.mode === 'remainder' ? null : +r.amount, auto: !!r.auto, mode: r.mode, reserve: +r.reserve || 0, grp: r.when });
  }
  for (const c of C.dca) {
    for (const day of c.days) {
      items.push({ key: `${k}|d|${c.id}|${day}`, date: shiftDate(occ(k, +day), 'after'), title: `${accName(c.account)} 定期定額 ${c.code}${c.name ? ' ' + c.name : ''}`, kind: 'invest', from: c.account, category: '定期定額', amount: +c.amount, auto: true, variable: !!c.variable, dca: true });
    }
  }
  for (const card of C.cards) {
    const close = occ(k, +card.closeDay), bk = `${card.id}|${close.slice(0, 7)}`;
    items.push({ key: `${k}|bill|${card.id}`, date: addDays(close, 1), title: `填 ${accName(card.id)}費`, kind: 'bill', card: card.id, billKey: bk, close, need: 'bill' });
    if (card.topUpFrom) items.push({ key: `${k}|top|${card.id}`, date: addDays(close, 1), title: `${accName(card.topUpFrom)} → ${accName(card.payFrom)}（補卡費）`, kind: 'transfer', from: card.topUpFrom, to: card.payFrom, amount: D.bills[bk] ?? null, auto: false, billKey: bk });
    const pay = occ(k, +card.payDay);
    let cp = dateIn(pay.slice(0, 7), +card.closeDay);
    if (cp >= pay) cp = dateIn(nextMonth(pay.slice(0, 7), -1), +card.closeDay);
    const pbk = `${card.id}|${cp.slice(0, 7)}`;
    items.push({ key: `${k}|pay|${card.id}`, date: shiftDate(pay, 'after'), title: `${accName(card.id)}費扣款`, kind: 'transfer', from: card.payFrom, to: card.id, category: '卡費', amount: D.bills[pbk] ?? null, auto: true, billKey: pbk, cardPay: true });
  }
  for (const it of items) {
    it.tx = txByRef(it.key);
    it.done = it.kind === 'bill' ? D.bills[it.billKey] != null : !!it.tx;
    it.before = it.date < C.startDate && it.need !== 'salary' && !it.done;
  }
  return items.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

// 到日子的自動項目（薪水、定期定額、ACH、卡費扣款…）自動入帳
function autopost() {
  const k = periodOf(TODAY);
  let n = 0;
  for (const kk of [nextMonth(k, -1), k]) {
    for (const it of plan(kk)) {
      if (!it.auto || it.tx || it.amount == null || it.date > TODAY || it.date < C.startDate) continue;
      D.tx.push({ id: uid(), ref: it.key, src: 'plan', date: it.date, kind: it.kind, amount: it.amount, from: it.from, to: it.to, category: it.category, note: it.title, auto: true });
      n++;
    }
  }
  if (n) save();
}

// 刷卡算哪一期：勾了「算下一期」就用下一次結帳的隔天當入帳日
function nextCloseAfter(card, date) { let c = dateIn(date.slice(0, 7), +card.closeDay); if (c < date) c = dateIn(nextMonth(date.slice(0, 7)), +card.closeDay); return c; }
function postDate(t) { if (!t.nextCycle) return t.date; const card = cardOf(t.from); return card ? addDays(nextCloseAfter(card, t.date), 1) : t.date; }

function cycle(card, ref = TODAY) {
  let close = dateIn(ref.slice(0, 7), +card.closeDay);
  if (close < ref) close = dateIn(nextMonth(ref.slice(0, 7)), +card.closeDay);
  const prev = dateIn(nextMonth(close.slice(0, 7), -1), +card.closeDay), start = addDays(prev, 1);
  const spend = sum(D.tx.filter(t => t.kind === 'expense' && t.from === card.id && postDate(t) >= start && postDate(t) <= close), t => t.amount);
  return { start, end: close, spend };
}

// 信用卡：上一次結帳的帳單（待繳）和結帳後新刷的（算下一期）分開
function cardStatus(card) {
  const cy = cycle(card), lastClose = addDays(cy.start, -1), key = `${card.id}|${lastClose.slice(0, 7)}`;
  const prevStart = addDays(dateIn(nextMonth(lastClose.slice(0, 7), -1), +card.closeDay), 1);
  const est = sum(D.tx.filter(t => t.kind === 'expense' && t.from === card.id && postDate(t) >= prevStart && postDate(t) <= lastClose), t => t.amount);
  let payItem = null;
  const k = periodOf(TODAY);
  for (const kk of [nextMonth(k, -1), k, nextMonth(k)]) { const it = plan(kk).find(i => i.cardPay && i.to === card.id && i.billKey === key); if (it) { payItem = it; break; } }
  const filled = D.bills[key] != null, bill = filled ? D.bills[key] : est;
  return { key, lastClose, bill, filled, paid: !!(payItem && payItem.tx), payDate: payItem ? payItem.date : null, newSpend: cy.spend, cy };
}

// ---------- 預算：這期還能花多少 ----------
function budget(k) {
  const items = plan(k), inP = t => periodOfTx(t) === k, P = D.periods[k] || {};
  const val = i => i.tx ? +i.tx.amount : (+i.amount || 0);
  const salary = P.salary;
  const otherIncome = sum(items.filter(i => i.kind === 'income' && i.need !== 'salary'), val) + sum(D.tx.filter(t => !t.ref && t.kind === 'income' && inP(t)), t => t.amount);
  const income = (salary || 0) + otherIncome;
  const fixedItems = items.filter(i => i.kind === 'expense' || i.kind === 'invest');
  const fixed = sum(fixedItems, val);
  const invest = sum(fixedItems.filter(i => i.kind === 'invest'), val) + sum(D.tx.filter(t => !t.ref && t.kind === 'invest' && inP(t)), t => t.amount);
  const manualInvest = sum(D.tx.filter(t => !t.ref && t.kind === 'invest' && inP(t)), t => t.amount);
  const spentTx = D.tx.filter(t => inP(t) && t.kind === 'expense' && t.src !== 'plan');
  const spent = sum(spentTx, t => t.amount);
  const saved = sum(D.tx.filter(t => t.kind === 'jar' && !t.opening && inP(t)), t => t.amount);
  const base = income - fixed - manualInvest;
  const remaining = base - spent - saved;
  return { items, salary, income, fixed, invest, spent, saved, base, remaining, spentTx };
}

function pending(k) {
  const items = plan(k), out = [];
  for (const it of items) {
    if (it.done || it.before) continue;
    if (it.need === 'salary') { if (it.amount == null && TODAY >= dateIn(k, C.salary.remindDay)) out.push(it); continue; }
    if (it.date > TODAY) continue;
    if (it.kind === 'bill') { out.push(it); continue; }
    if (!it.auto && (it.amount != null || it.mode === 'remainder')) out.push(it);
  }
  return out;
}

// 接下來 3 週，自動扣款前帳戶夠不夠
function forecast() {
  const b = balances(TODAY), k = periodOf(TODAY), lim = addDays(TODAY, 21), warned = {}, out = [];
  const items = [...plan(k), ...plan(nextMonth(k))].filter(i => i.auto && !i.tx && i.date > TODAY && i.date <= lim && i.amount != null && i.date >= C.startDate);
  items.sort((a, c) => a.date < c.date ? -1 : 1);
  const byDate = {};
  for (const i of items) (byDate[i.date] ||= []).push(i);
  for (const d of Object.keys(byDate).sort()) {
    const day = byDate[d];
    for (const i of day) {
      if (i.kind === 'income' && i.to in b) b[i.to] += i.amount;
      if (i.kind === 'transfer') { if (i.from in b) b[i.from] -= i.amount; if (i.to in b) b[i.to] += i.amount; }
      if ((i.kind === 'expense' || i.kind === 'invest') && i.from in b) b[i.from] -= i.amount;
    }
    for (const i of day) {
      const f = i.from; if (!f || !(f in b) || acc(f).type === 'card' || warned[f]) continue;
      if (b[f] < 0) {
        warned[f] = 1;
        const total = sum(day.filter(x => x.from === f), x => x.amount);
        out.push({ acc: f, date: d, total, short: -b[f], titles: day.filter(x => x.from === f).map(x => x.title) });
      }
    }
  }
  return out;
}

// ---------- 畫面 ----------
let route = 'home', statsKey = null;
const V = {};
function render() {
  if (!S) { $('#view').innerHTML = onboarding(); $('#tabs').hidden = true; return; }
  $('#tabs').hidden = false;
  route = (location.hash || '#home').slice(1) || 'home';
  const base = route.split('/')[0];
  document.querySelectorAll('.tabs [data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === (base.startsWith('set') || base === 'jars' ? (base === 'jars' ? 'home' : 'acct') : base)));
  const fn = V[base] || V.home;
  $('#view').innerHTML = fn(route.split('/').slice(1));
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

function onboarding() {
  return `<h1>錢錢管家</h1><p class="muted">第一次使用，選一種開始方式</p>
  <div class="card"><b>📥 匯入初始設定檔</b><p class="muted">有設定檔（.json）的話選這個，帳戶、固定項目、定期定額會一次設定好</p><button class="btn" data-act="import">選擇檔案</button></div>
  <div class="card"><b>🧪 先看示範</b><p class="muted">用假資料逛逛看，之後可以在「帳戶 → 清除資料」重來</p><button class="btn ghost" data-act="demo">使用示範資料</button></div>
  <div class="card"><b>✏️ 從空白開始</b><p class="muted">自己在設定裡新增帳戶和項目</p><button class="btn ghost" data-act="blank">空白開始</button></div>`;
}

V.home = () => {
  const k = periodOf(TODAY), { start, end } = range(k), B = budget(k);
  const total = diff(start, end) + 1, left = diff(TODAY, end) + 1, passed = total - left;
  let h = `<div class="muted">本期 ${mdw(start)} – ${mdw(end)}・還有 ${left} 天</div><h1>錢錢管家</h1>`;
  if (B.salary == null) {
    h += `<div class="card hero"><div class="muted">這期薪水還沒輸入</div><div class="big" style="font-size:28px">輸入薪水後才算得出能花多少</div><button class="btn" style="background:#fff;color:var(--brand)" data-act="salary" data-k="${k}">輸入 ${+k.slice(5)} 月薪水</button></div>`;
  } else {
    const perDay = Math.max(0, B.remaining) / Math.max(1, left);
    const tp = Math.round(passed / total * 100), sp = B.base > 0 ? Math.round((B.spent + B.saved) / B.base * 100) : 0;
    const msg = B.remaining < 0 ? '已經超支了' : sp > tp + 5 ? '稍微快了一點' : sp < tp - 5 ? '控制得很好 👍' : '剛剛好';
    h += `<div class="card hero"><div class="row"><span class="muted">今天可以花</span><span class="muted">這期還能花 ${fmt(B.remaining)}</span></div>
      <div class="big">$ ${fmt(perDay)}</div>
      <div class="pace"><i style="width:${Math.min(100, Math.max(0, sp))}%"></i><u style="left:${tp}%"></u></div>
      <div class="muted">時間過了 ${tp}%，錢花了 ${sp}%・${msg}</div></div>`;
  }
  // 提醒
  const nk = nextMonth(k);
  if (TODAY >= dateIn(TODAY.slice(0, 7), C.salary.remindDay) && periodOf(TODAY) !== TODAY.slice(0, 7) && (D.periods[TODAY.slice(0, 7)] || {}).salary == null)
    h += `<div class="note">💰 ${+TODAY.slice(5, 7)} 月薪水快入帳了（${mdw(payday(TODAY.slice(0, 7)))}）・<a class="link" data-act="salary" data-k="${TODAY.slice(0, 7)}">先輸入金額</a></div>`;
  const hasBal = D.tx.some(t => t.kind === 'adjust' || t.opening);
  if (hasBal) for (const w of forecast())
    h += `<div class="warn">⚠️ ${esc(accName(w.acc))} ${md(w.date)} 要扣 ${fmt(w.total)}（${esc(w.titles.join('、'))}），餘額不足 ${fmt(w.short)}</div>`;
  for (const card of C.cards) {
    const cy = cycle(card);
    if (card.alert && cy.spend > card.alert) h += `<div class="warn">💳 ${esc(accName(card.id))}這期已刷 ${fmt(cy.spend)}，超過示警值 ${fmt(card.alert)}</div>`;
  }
  if (!D.tx.some(t => t.kind === 'adjust' || t.opening)) h += `<div class="info">👋 第一次使用：先<a class="link" href="#set-bal">輸入各帳戶目前的餘額</a>，App 才算得出正確的錢</div>`;
  if (dow(TODAY) === +C.reconDay && D.recon.last !== TODAY) h += `<div class="info">🧾 今天是對帳日：數一下錢包、對一下各帳戶餘額・<a class="link" href="#acct">去對帳</a></div>`;
  if (!D.lastExport || diff(D.lastExport, TODAY) >= 7) h += `<div class="note">💾 ${D.lastExport ? `上次備份是 ${md(D.lastExport)}` : '還沒備份過'}・<a class="link" data-act="export">現在匯出</a></div>`;
  // 各帳戶餘額（LINE Bank 這類放罐子的帳戶顯示主帳戶＋分割帳戶的總額）
  const jt = sum(C.jars, j => jarBalances()[j.id] || 0);
  const bal = balances(), shown = C.accounts.filter(a => a.type !== 'cash');
  if (shown.length) {
    const tile = (label, v, sub, red) => `<div class="card" style="margin:0;padding:10px"><div class="muted small">${label}</div><div style="font-weight:700;font-size:16px;margin-top:2px;${red ? 'color:var(--red)' : ''}">${fmt(v)}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
    const tiles = [];
    for (const a of shown) {
      if (a.type === 'card') {
        const card = cardOf(a.id);
        if (!card) { const v = -bal[a.id]; tiles.push(tile(`💳 ${esc(a.name)}`, Math.abs(v), v < 0 ? '溢繳' : '未繳')); continue; }
        const st = cardStatus(card);
        tiles.push(tile(`💳 ${esc(a.name)}`, st.paid ? 0 : st.bill, st.paid ? `${md(st.lastClose)} 帳單已繳・新刷 ${fmt(st.newSpend)}` : `${st.filled ? '待繳' : '待繳（估）'}${st.payDate ? ' ' + md(st.payDate) + ' 扣' : ''}・新刷 ${fmt(st.newSpend)}`));
        continue;
      }
      const isSv = a.id === C.savings && C.jars.length;
      tiles.push(tile(esc(a.name), bal[a.id], isSv ? '可用餘額' : '', bal[a.id] < 0));
      if (isSv) tiles.push(tile(`🐷 ${esc(a.name)} 罐子`, jt, `${C.jars.length} 個分割帳戶`));
    }
    h += `<h2>帳戶餘額</h2><a class="grid3" href="#acct">${tiles.join('')}</a>`;
  }
  // 存錢罐
  const jb = jarBalances();
  h += `<a class="card" href="#jars" style="display:block"><div class="row"><b>🐷 存錢罐</b><span class="muted">這期存了 ${fmt(B.saved)} ›</span></div>`;
  for (const j of C.jars) {
    const v = jb[j.id] || 0, pct = j.target > 0 ? Math.min(100, v / j.target * 100) : 0;
    h += `<div class="row" style="margin-top:10px"><span>${esc(j.emoji)} ${esc(j.name)}</span><span class="muted">${fmt(v)}${j.target > 0 ? ' / ' + fmt(j.target) : ''}</span></div>${j.target > 0 ? `<div class="bar"><i style="width:${pct}%;background:${esc(j.color)}"></i></div>` : ''}`;
  }
  h += `</a>`;
  // 刷卡
  if (C.cards.length) {
    h += `<div class="mini">`;
    for (const card of C.cards) {
      const cy = cycle(card), pct = card.alert ? cy.spend / card.alert * 100 : 0;
      const cls = pct > 100 ? 'red' : pct >= 80 ? 'amber' : '', tag = pct > 100 ? '<span class="tag red">超過示警值</span>' : pct >= 80 ? '<span class="tag amber">快到示警值</span>' : '<span class="tag">安全</span>';
      h += `<a class="card" href="#set-cards"><b>💳 ${esc(accName(card.id))}</b><div class="muted">${md(cy.start)}–${md(cy.end)}</div><div class="bar ${cls}"><i style="width:${Math.min(100, pct)}%"></i></div><div class="row"><b>${fmt(cy.spend)}</b><span class="muted">/ ${fmt(card.alert)}</span></div>${tag}</a>`;
    }
    h += `</div>`;
  }
  const bal2 = balances(), cash = C.accounts.find(a => a.type === 'cash'), pend = pending(k);
  const lastW = D.tx.filter(t => t.kind === 'transfer' && cash && t.to === cash.id).sort((a, b) => a.date < b.date ? 1 : -1)[0];
  h += `<div class="mini">${cash ? `<a class="card" href="#acct"><b>👛 現金錢包</b><div class="num">${fmt(bal2[cash.id])}</div><span class="muted">${lastW ? `${md(lastW.date)} 領 ${fmt(lastW.amount)}` : '還沒領過現金'}</span></a>` : ''}
    <a class="card" href="#list"><b>📋 待處理</b><div class="num">${pend.length} 件</div>${pend[0] ? `<span class="muted">${esc(pend[0].title)}</span>` : '<span class="tag">都處理好了</span>'}</a></div>`;
  return h;
};

V.list = () => {
  const k = periodOf(TODAY), { start, end } = range(k), items = plan(k), bal = balances();
  let h = `<h1>本期清單</h1><div class="muted">${mdw(start)} – ${mdw(end)}・打勾會自動記下日期，點日期可以改</div>`;
  const groups = {};
  for (const it of items) (groups[it.date] ||= []).push(it);
  for (const d of Object.keys(groups).sort()) {
    const label = d === start ? '發薪日' : d === addDays(start, 1) ? '發薪隔天' : '';
    const nominal = dateIn(k, C.salary.day);
    const tag = d === start && start !== nominal ? `<span class="tag">${+nominal.slice(8)} 日遇假日，提前</span>` : '';
    h += `<h2>${mdw(d)} ${label} ${tag}${d === TODAY ? ' <span class="tag blue">今天</span>' : ''}</h2><div class="card tight">`;
    for (const it of groups[d]) h += itemRow(it, bal);
    h += `</div>`;
  }
  if (C.checks.length) {
    h += `<h2>勾選項目</h2><div class="card tight">`;
    for (const c of C.checks) {
      const txs = D.tx.filter(t => t.ref && t.ref.startsWith(`${k}|c|${c.id}|`)).sort((a, b) => a.date < b.date ? -1 : 1);
      if (c.multi) {
        h += `<div class="item"><button class="btn sm" data-act="check-add" data-id="${c.id}">＋${fmt(c.amount)}</button><span class="grow">${esc(c.name)} <span class="muted">${esc(accName(c.from))}・本期 ${txs.length} 次</span></span><span class="date">${txs.map(t => `<a data-act="tx" data-id="${t.id}">${md(t.date)}</a>`).join('、')}</span></div>`;
      } else {
        const t = txs[0];
        h += `<div class="item"><button class="box ${t ? 'on' : ''}" data-act="check" data-id="${c.id}">${t ? '✓' : ''}</button><span class="grow ${t ? 'done' : ''}">${esc(c.name)} <span class="muted">${esc(accName(c.from))}</span></span>${t ? `<a class="date" data-act="tx" data-id="${t.id}">${md(t.date)}</a>` : ''}<span class="amt ${t ? 'done' : ''}">${fmt(c.amount)}</span></div>`;
      }
    }
    h += `</div>`;
  }
  return h;
};

function itemRow(it, bal) {
  const t = it.tx;
  if (it.before) return `<div class="item"><span class="tag gray">開始前</span><span class="grow muted">${esc(it.title)}</span><span class="muted">${it.amount == null ? '' : fmt(it.amount)}</span></div>`;
  if (it.need === 'salary') {
    return `<div class="item"><span class="tag ${it.amount == null ? 'amber' : ''}">${it.amount == null ? '待填' : it.done ? '已入帳' : '已輸入'}</span><span class="grow">薪水 → ${esc(accName(it.to))}</span><a class="amt link" data-act="salary" data-k="${it.key.split('|')[0]}">${it.amount == null ? '輸入 ›' : fmt(it.amount)}</a></div>`;
  }
  if (it.kind === 'bill') {
    const v = D.bills[it.billKey], card = cardOf(it.card), spend = card ? sum(D.tx.filter(x => x.kind === 'expense' && x.from === card.id && postDate(x) > dateIn(nextMonth(it.close.slice(0, 7), -1), +card.closeDay) && postDate(x) <= it.close), x => x.amount) : 0;
    return `<div class="item"><span class="tag ${v == null ? 'amber' : ''}">${v == null ? '待填' : '已填'}</span><span class="grow">${esc(it.title)} <span class="muted">${md(it.close)} 結帳・App 記到 ${fmt(spend)}</span></span><a class="amt link" data-act="bill" data-key="${esc(it.billKey)}" data-spend="${spend}">${v == null ? '填金額 ›' : fmt(v)}</a></div>`;
  }
  let amount = it.amount;
  if (it.mode === 'remainder' && !t) amount = Math.max(0, (bal[it.from] || 0) - it.reserve);
  const amtTxt = t ? fmt(t.amount) : amount == null ? '<span class="muted">等卡費</span>' : fmt(amount);
  const kindTag = it.kind === 'expense' ? `<span class="tag red">${esc(it.category || '支出')}</span>` : it.kind === 'invest' ? '<span class="tag blue">投資</span>' : '';
  const extra = (it.mode === 'remainder' && !t ? ' <span class="tag blue">App 算好</span>' : '') + (it.variable ? ' <span class="tag amber">加減碼</span>' : '');
  if (it.auto) {
    return `<div class="item"><span class="tag ${t ? '' : 'gray'}">${t ? '✓ 自動' : '自動'}</span><span class="grow ${t ? 'done' : ''}">${esc(it.title)} ${kindTag}${extra}</span>${t ? `<a class="date" data-act="tx" data-id="${t.id}">${md(t.date)}</a>` : ''}<span class="amt ${t ? 'done' : ''}">${amtTxt}</span></div>`;
  }
  return `<div class="item"><button class="box ${t ? 'on' : ''}" data-act="tick" data-key="${esc(it.key)}" ${amount == null && !t ? 'disabled style="opacity:.4"' : ''}>${t ? '✓' : ''}</button><span class="grow ${t ? 'done' : ''}">${esc(it.title)} ${kindTag}${extra}</span>${t ? `<a class="date" data-act="tx" data-id="${t.id}">${md(t.date)}</a>` : ''}<span class="amt ${t ? 'done' : ''}">${amtTxt}</span></div>`;
}

V.stats = () => {
  const k = statsKey || periodOf(TODAY), { start, end } = range(k), B = budget(k), pk = nextMonth(k, -1), PB = budget(pk);
  const jarSpend = sum(B.spentTx.filter(t => t.jar), t => t.amount);
  const normalSpend = B.spent - jarSpend;
  const fixedExp = sum(B.items.filter(i => i.kind === 'expense'), i => i.tx ? i.tx.amount : (i.amount || 0));
  const exp = normalSpend + fixedExp;
  const pExp = (PB.spent - sum(PB.spentTx.filter(t => t.jar), t => t.amount)) + sum(PB.items.filter(i => i.kind === 'expense'), i => i.tx ? i.tx.amount : (i.amount || 0));
  const tagDiff = (a, b, good) => { const d = a - b; if (!b || !d) return ''; const up = d > 0; return `<span class="tag ${up === good ? '' : 'red'}">比上期 ${up ? '+' : ''}${fmt(d)}</span>`; };
  let h = `<div class="row"><h1>月底分析</h1><span class="muted"><a data-act="pk" data-k="${pk}">‹</a> ${md(start)} – ${md(end)} ${k < periodOf(TODAY) ? `<a data-act="pk" data-k="${nextMonth(k)}">›</a>` : ''}</span></div>`;
  h += `<div class="stat"><div class="card"><span class="muted">收入</span><b>${fmt(B.income)}</b>${B.salary == null ? '<span class="tag amber">薪水待填</span>' : ''}</div>
    <div class="card"><span class="muted">支出</span><b>${fmt(exp)}</b>${tagDiff(exp, pExp, false)}</div>
    <div class="card"><span class="muted">投資</span><b>${fmt(B.invest)}</b><span class="muted small">定期定額＋基金</span></div>
    <div class="card"><span class="muted">存進罐子</span><b>${fmt(B.saved)}</b>${tagDiff(B.saved, PB.saved, true)}</div></div>`;
  if (B.income > 0) {
    const un = Math.max(0, B.income - exp - B.invest - B.saved - jarSpend);
    const rows = [['投資', B.invest, '#2f6f5e'], ['支出', exp, '#c8463d'], ['存下', B.saved, '#3b6fb6'], ['罐子花費', jarSpend, '#b7791f'], ['還沒用', un, '#9aa3ad']].filter(r => r[1] > 0);
    h += `<div class="card"><div class="row"><b>錢都去哪了</b><span class="muted">佔收入</span></div>${rows.map(r => `<div class="hb"><span class="t">${r[0]}</span><span class="b"><i style="width:${Math.min(100, r[1] / B.income * 100)}%;background:${r[2]}"></i></span><span>${Math.round(r[1] / B.income * 100)}%</span></div>`).join('')}</div>`;
  }
  // 類別
  const cats = {};
  const addCat = (c, v) => { cats[c || '其他'] = (cats[c || '其他'] || 0) + v; };
  for (const t of B.spentTx) if (!t.jar) addCat(t.category, +t.amount);
  for (const i of B.items.filter(i => i.kind === 'expense')) addCat(i.category, i.tx ? +i.tx.amount : (+i.amount || 0));
  const list = Object.entries(cats).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  if (list.length) {
    const tot = sum(list, x => x[1]);
    let off = 25, arcs = '';
    list.forEach(([c, v], i) => { const p = v / tot * 100; arcs += `<circle cx="21" cy="21" r="15.9" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="7" stroke-dasharray="${p} ${100 - p}" stroke-dashoffset="${off}"/>`; off -= p; });
    h += `<div class="card"><b>支出類別</b><div class="row" style="margin-top:8px;align-items:center"><svg width="120" height="120" viewBox="0 0 42 42" style="flex:none">${arcs}</svg><div class="legend grow">${list.map(([c, v], i) => `<div><span class="dot" style="background:${COLORS[i % COLORS.length]}"></span><span class="grow">${esc(catEmoji(c))} ${esc(c)} ${Math.round(v / tot * 100)}%</span><span>${fmt(v)}</span></div>`).join('')}</div></div></div>`;
    // 白話提醒
    const pc = {};
    for (const t of PB.spentTx) if (!t.jar) pc[t.category || '其他'] = (pc[t.category || '其他'] || 0) + +t.amount;
    let best = null;
    for (const [c, v] of list) { const d = v - (pc[c] || 0); if (pc[c] && (!best || d > best[1])) best = [c, d]; }
    if (best && best[1] > 0) h += `<div class="card">💡 這期「${esc(best[0])}」比上期多 ${fmt(best[1])}。</div>`;
  }
  if (jarSpend) h += `<div class="card">🐷 從存錢罐拿出來花了 ${fmt(jarSpend)}，這部分不算在一般支出裡。</div>`;
  // 明細
  const txs = D.tx.filter(t => periodOfTx(t) === k).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  h += `<h2>本期明細（${txs.length} 筆）</h2><div class="card tight">${txs.length ? txs.map(txRow).join('') : '<div class="empty">還沒有記錄</div>'}</div>`;
  return h;
};
const catEmoji = c => (C.categories.find(x => x.name === c) || {}).emoji || SYS_CATS[c] || '📦';
function txRow(t) {
  const sign = t.kind === 'income' ? '+' : t.kind === 'expense' || t.kind === 'invest' ? '−' : '';
  const em = t.kind === 'transfer' ? '🔁' : t.kind === 'jar' ? '🐷' : t.kind === 'adjust' ? '🧾' : catEmoji(t.category);
  const desc = t.kind === 'transfer' ? `${accName(t.from)} → ${accName(t.to)}` : t.kind === 'jar' ? `${(C.jars.find(j => j.id === t.jar) || {}).name || '罐子'} ${t.amount >= 0 ? '存入' : '拿出'}` : t.kind === 'adjust' ? `${accName(t.to)} 對帳調整` : (t.kind === 'income' ? accName(t.to) : accName(t.from));
  return `<a class="txrow" data-act="tx" data-id="${t.id}"><span class="emoji">${em}</span><span class="grow"><div>${esc(t.note || t.category || KINDS[t.kind] || '')}</div><div class="muted small">${md(t.date)}・${esc(desc)}${t.nextCycle ? '・⏭️ 下一期' : ''}</div></span><span class="amt">${sign}${fmt(Math.abs(t.amount))}</span></a>`;
}

V.acct = () => {
  const bal = balances();
  let h = `<h1>帳戶與對帳</h1><div class="muted">輸入銀行 App 上的實際餘額，看看有沒有漏記${D.recon.last ? `・上次對帳 ${md(D.recon.last)}` : ''}</div><div class="card tight">`;
  for (const a of C.accounts) {
    const r = (D.recon.acc || {})[a.id];
    const ok = r && r.date === TODAY;
    h += `<div class="item"><span class="grow"><b>${a.type === 'cash' ? '👛 ' : a.type === 'card' ? '💳 ' : ''}${esc(a.name)}</b><br><span class="muted">App 算的 ${fmt(bal[a.id])}${a.type === 'card' ? '（負數＝總共欠多少：已結帳帳單＋結帳後新刷的）' : ''}</span></span>${ok ? `<span class="tag ${r.delta ? 'amber' : ''}">${r.delta ? `已調整 ${r.delta > 0 ? '+' : ''}${fmt(r.delta)}` : '✓ 對上了'}</span>` : `<a class="link" data-act="recon" data-id="${a.id}">輸入實際餘額 ›</a>`}</div>`;
  }
  h += `</div><a class="btn ghost" href="#set-bal">✏️ 一次輸入全部帳戶的目前餘額</a><h2>設定</h2><div class="card tight">
    <a class="item" href="#set-cards"><span class="grow">💳 刷卡示警</span><span class="muted">›</span></a>
    <a class="item" href="#jars"><span class="grow">🐷 存錢罐</span><span class="muted">›</span></a>
    <a class="item" href="#set-list/rules"><span class="grow">📅 固定項目（轉帳、扣款、固定收入）</span><span class="muted">›</span></a>
    <a class="item" href="#set-list/dca"><span class="grow">📈 定期定額</span><span class="muted">›</span></a>
    <a class="item" href="#set-list/checks"><span class="grow">☑️ 勾選項目</span><span class="muted">›</span></a>
    <a class="item" href="#set-list/cards"><span class="grow">💳 信用卡（結帳日、扣款日）</span><span class="muted">›</span></a>
    <a class="item" href="#set-list/accounts"><span class="grow">🏦 帳戶</span><span class="muted">›</span></a>
    <a class="item" href="#set-list/categories"><span class="grow">🏷️ 類別</span><span class="muted">›</span></a>
    <a class="item" href="#set-general"><span class="grow">⚙️ 發薪日、對帳日、行事曆</span><span class="muted">›</span></a>
  </div><h2>備份</h2><div class="card tight">
    <a class="item" data-act="export"><span class="grow">💾 匯出備份</span><span class="muted">${D.lastExport ? '上次 ' + md(D.lastExport) : '還沒備份過'}・本機／Google Drive ›</span></a>
    <a class="item" data-act="import"><span class="grow">📥 匯入備份／初始設定檔</span><span class="muted">›</span></a>
    <a class="item" data-act="reset"><span class="grow" style="color:var(--red)">🗑️ 清除所有資料</span><span class="muted">›</span></a>
  </div><p class="muted small" style="margin-top:14px;text-align:center">資料只存在這支手機的瀏覽器裡，記得定期匯出備份</p>`;
  return h;
};

V.jars = () => {
  const jb = jarBalances(), bal = balances(), sv = C.savings, tot = sum(C.jars, j => jb[j.id] || 0);
  let h = `<div class="row"><a class="muted" href="#home">‹ 首頁</a><b>存錢罐</b><span style="width:40px"></span></div>`;
  if (sv && acc(sv).type !== 'ext') {
    h += `<div class="card hero"><div class="muted">${esc(accName(sv))} 總額（主帳戶＋分割帳戶）</div><div class="big" style="font-size:30px">${fmt((bal[sv] || 0) + tot)}</div><div class="muted">主帳戶 ${fmt(bal[sv])}・${C.jars.length} 個分割帳戶共 ${fmt(tot)}</div></div>`;
  }
  for (const j of C.jars) {
    const v = jb[j.id] || 0, pct = j.target > 0 ? Math.min(100, v / j.target * 100) : 0;
    let hint = '';
    if (j.target > 0) {
      const gap = j.target - v;
      if (gap <= 0) hint = '<span class="tag">🎉 已經存滿</span>';
      else if (j.targetDate) {
        const months = Math.max(1, (+j.targetDate.slice(0, 4) - +TODAY.slice(0, 4)) * 12 + (+j.targetDate.slice(5, 7) - +TODAY.slice(5, 7)));
        hint = `<span class="muted">還差 ${fmt(gap)}，離目標還有 ${months} 個月（平均每月約 ${fmt(Math.ceil(gap / months / 100) * 100)}）</span>`;
      } else hint = `<span class="muted">還差 ${fmt(gap)}</span>`;
    }
    h += `<div class="card"><div class="row"><b>${esc(j.emoji)} ${esc(j.name)}</b><a class="muted" data-act="jar-edit" data-id="${j.id}">編輯 ›</a></div>
      ${j.target > 0 ? `<div class="bar"><i style="width:${pct}%;background:${esc(j.color)}"></i></div>` : ''}
      <div class="row"><span><b>${fmt(v)}</b>${j.target > 0 ? ` <span class="muted">/ ${fmt(j.target)}</span>` : ''}</span>${j.target > 0 ? `<span class="muted">${Math.round(pct)}%</span>` : ''}</div>
      <div style="margin-top:4px">${hint}${j.targetDate ? ` <span class="muted">・目標 ${esc(j.targetDate.replace('-', '/'))}</span>` : ''}</div></div>`;
  }
  h += `<div class="row" style="margin-top:14px"><button class="btn" style="margin:0" data-act="jar-in">＋ 存進去</button><button class="btn ghost" style="margin:0" data-act="jar-out">－ 拿出來用</button></div>`;
  const hist = D.tx.filter(t => t.kind === 'jar').sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 15);
  if (hist.length) h += `<h2>最近紀錄</h2><div class="card tight">${hist.map(txRow).join('')}</div>`;
  return h;
};

V['set-bal'] = () => {
  const bal = balances(), jb = jarBalances();
  return `<div class="row"><a class="muted" href="#acct">‹ 帳戶</a><b>輸入目前餘額</b><span style="width:40px"></span></div>
  <p class="muted" style="margin-top:8px">打開各銀行 App，照實際餘額填（LINE Bank 填主帳戶，分割帳戶填在最下面）。沒變的不用動；信用卡填「目前還沒繳的金額」（刷了還沒繳的錢），沒欠就填 0</p>
  <form id="balf"><div class="card">${C.accounts.map(a => `<div class="field"><label>${a.type === 'cash' ? '👛 ' : a.type === 'card' ? '💳 ' : '🏦 '}${esc(a.name)}${a.type === 'card' ? '（還沒繳的金額）' : ''}</label><input name="${a.id}" type="number" inputmode="numeric" value="${a.type === 'card' ? -bal[a.id] : bal[a.id]}" data-was="${a.type === 'card' ? -bal[a.id] : bal[a.id]}"></div>`).join('')}
  ${C.jars.length ? `<h2 style="margin-top:14px">${esc(accName(C.savings))} 分割帳戶（存錢罐）</h2>${C.jars.map(j => `<div class="field"><label>${esc(j.emoji)} ${esc(j.name)}</label><input name="jar_${j.id}" type="number" inputmode="numeric" value="${jb[j.id] || 0}" data-was="${jb[j.id] || 0}"></div>`).join('')}` : ''}
  <div class="field"><label>以哪天為準</label><input name="__date" type="date" value="${TODAY}"></div></div>
  <button class="btn" data-act="bal-save">儲存</button></form>`;
};

V['set-cards'] = () => {
  let h = `<div class="row"><a class="muted" href="#acct">‹ 設定</a><b>刷卡示警</b><span style="width:40px"></span></div>`;
  if (!C.cards.length) h += `<div class="card empty">還沒有信用卡，先到「設定 → 信用卡」新增</div>`;
  for (const card of C.cards) {
    h += `<div class="card"><div class="row"><b>💳 ${esc(accName(card.id))}</b><span class="muted">每月 ${card.closeDay} 日結帳</span></div>
      <div class="row" style="margin-top:10px"><span>示警值</span><b style="font-size:21px" id="al-${card.id}">${fmt(card.alert)}</b></div>
      <input type="range" min="5000" max="20000" step="500" value="${card.alert || 10000}" data-alert="${card.id}">
      <div class="row muted"><span>5,000</span><span>20,000</span></div></div>`;
  }
  h += `<div class="card small" style="line-height:1.9"><b>顏色怎麼變</b><br><span class="tag">安全</span> 不到示警值的 80%<br><span class="tag amber">快到示警值</span> 80%–100%<br><span class="tag red">超過示警值</span> 超過了，首頁會跳紅色提醒<br><span class="muted">每 500 元一格；從上次結帳隔天算到這次結帳日</span></div>`;
  return h;
};

V['set-general'] = () => {
  const y = +TODAY.slice(0, 4);
  const calTxt = yy => CAL[yy] ? `已下載（${CAL[yy].h.length} 天平日放假、${CAL[yy].w.length} 天補班）` : '還沒下載，暫時用週末＋固定國定假日推算';
  const k = periodOf(TODAY), nk = nextMonth(k);
  return `<div class="row"><a class="muted" href="#acct">‹ 設定</a><b>一般設定</b><span style="width:40px"></span></div>
  <div class="card"><div class="field"><label>每月發薪日（遇假日提前到上一個上班日）</label><input type="number" inputmode="numeric" data-cfg="salary.day" value="${C.salary.day}"></div>
  <div class="field"><label>薪水入哪個帳戶</label>${accSelect('salary.to', C.salary.to, 'data-cfg')}</div>
  <div class="field"><label>每月幾號提醒輸入薪水</label><input type="number" inputmode="numeric" data-cfg="salary.remindDay" value="${C.salary.remindDay}"></div>
  <div class="field"><label>存錢罐的錢放在哪個帳戶</label>${accSelect('savings', C.savings, 'data-cfg')}</div>
  <div class="field"><label>每週對帳日</label><select data-cfg="reconDay">${[...WK].map((w, i) => `<option value="${i}" ${+C.reconDay === i ? 'selected' : ''}>週${w}</option>`).join('')}</select></div>
  <div class="field"><label>從哪天開始自動記帳（之前的不會補記）</label><input type="date" data-cfg="startDate" value="${C.startDate}"></div></div>
  <h2>這期和下期的發薪日</h2><div class="card"><p class="muted">遇到特殊情況（例如颱風假、臨時調整）可以手動改</p>
  <div class="field"><label>${+k.slice(5)} 月：${mdw(payday(k))}</label><input type="date" data-payday="${k}" value="${payday(k)}"></div>
  <div class="field"><label>${+nk.slice(5)} 月：${mdw(payday(nk))}</label><input type="date" data-payday="${nk}" value="${payday(nk)}"></div></div>
  <h2>台灣上班日曆</h2><div class="card"><div>${y} 年：${calTxt(y)}</div><div style="margin-top:6px">${y + 1} 年：${calTxt(y + 1)}</div>
  <p class="muted small" style="margin-top:6px">資料來源：人事行政總處辦公日曆（開源整理版），有網路時自動下載</p><button class="btn ghost" data-act="cal">重新下載</button></div>`;
};
function accSelect(name, val, attr = 'name', types) {
  return `<select ${attr}="${name}"><option value="">（無）</option>${C.accounts.filter(a => !types || types.includes(a.type)).map(a => `<option value="${a.id}" ${a.id === val ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`;
}

// ---------- 通用清單編輯 ----------
const EDIT = {
  rules: { title: '固定項目', fields: [['name', '名稱', 'text'], ['kind', '種類', 'kind'], ['amount', '金額', 'num'], ['mode', '金額算法', 'mode'], ['reserve', '（App 算好時）帳戶要留多少', 'num'], ['from', '從哪個帳戶', 'acct'], ['to', '到哪個帳戶', 'acct'], ['category', '類別（支出用）', 'text'], ['when', '哪天', 'when'], ['day', '（每月固定日）幾號', 'num'], ['shift', '遇假日', 'shift'], ['auto', '銀行自動扣／自動入帳（不用打勾）', 'bool'], ['enabled', '啟用', 'bool']],
    blank: () => ({ id: uid(), name: '', kind: 'transfer', amount: 0, mode: 'fixed', reserve: 0, from: '', to: '', category: '', when: 'payday', day: 1, shift: 'none', auto: false, enabled: true }),
    label: r => `${r.name}${r.enabled === false ? '（停用）' : ''}`, sub: r => `${KINDS[r.kind]}・${r.mode === 'remainder' ? `App 算好（留 ${fmt(r.reserve)}）` : fmt(r.amount)}・${r.when === 'payday' ? '發薪日' : r.when === 'payday+1' ? '發薪隔天' : `每月 ${r.day} 日`}${r.auto ? '・自動' : ''}` },
  dca: { title: '定期定額', fields: [['account', '扣款帳戶', 'acct'], ['code', '代號', 'text'], ['name', '名稱', 'text'], ['amount', '每次金額', 'num'], ['days', '每月扣款日（用逗號分開，例如 6,16,26）', 'days'], ['variable', '智慧加減碼（實際金額會變）', 'bool']],
    blank: () => ({ id: uid(), account: '', code: '', name: '', amount: 0, days: [], variable: false }),
    label: r => `${r.code} ${r.name}`, sub: r => `${accName(r.account)}・${fmt(r.amount)}・每月 ${r.days.join('、')} 日` },
  checks: { title: '勾選項目', fields: [['name', '名稱', 'text'], ['amount', '金額', 'num'], ['from', '從哪個帳戶付', 'acct'], ['category', '類別', 'cat'], ['multi', '一期可以按很多次', 'bool']],
    blank: () => ({ id: uid(), name: '', amount: 0, from: '', category: '其他', multi: false }),
    label: r => r.name, sub: r => `${accName(r.from)}・${fmt(r.amount)}${r.multi ? '・可多次' : ''}` },
  cards: { title: '信用卡', fields: [['id', '信用卡帳戶', 'card'], ['closeDay', '每月結帳日', 'num'], ['payDay', '每月扣款日', 'num'], ['payFrom', '從哪個帳戶扣卡費', 'acct'], ['topUpFrom', '結帳後要先從哪個帳戶補錢進去（不用就留空）', 'acct'], ['alert', '刷卡示警值', 'num']],
    blank: () => ({ id: '', closeDay: 1, payDay: 15, payFrom: '', topUpFrom: '', alert: 10000 }),
    label: r => accName(r.id), sub: r => `${r.closeDay} 日結帳・${r.payDay} 日從 ${accName(r.payFrom)} 扣` },
  accounts: { title: '帳戶', fields: [['name', '名稱', 'text'], ['type', '種類', 'atype']],
    blank: () => ({ id: uid(), name: '', type: 'bank' }),
    label: r => r.name, sub: r => ({ bank: '銀行', cash: '現金', card: '信用卡' }[r.type] || r.type) },
  categories: { title: '類別', fields: [['emoji', '圖示（一個表情符號）', 'text'], ['name', '名稱', 'text']],
    blank: () => ({ name: '', emoji: '📦' }), label: r => `${r.emoji} ${r.name}`, sub: () => '' }
};
V['set-list'] = ([type]) => {
  const E = EDIT[type]; if (!E) return '';
  const arr = C[type];
  return `<div class="row"><a class="muted" href="#acct">‹ 設定</a><b>${E.title}</b><a class="link" data-act="ed-new" data-type="${type}">新增</a></div>
  <div class="card tight">${arr.length ? arr.map((r, i) => `<a class="item" data-act="ed" data-type="${type}" data-i="${i}"><span class="grow">${esc(E.label(r))}<br><span class="muted small">${esc(E.sub(r))}</span></span><span class="muted">›</span></a>`).join('') : '<div class="empty">還沒有項目</div>'}</div>`;
};
function fieldInput([k, label, type], v) {
  const opt = (pairs) => pairs.map(([a, b]) => `<option value="${a}" ${String(v) === String(a) ? 'selected' : ''}>${b}</option>`).join('');
  let inp;
  if (type === 'num') inp = `<input name="${k}" type="number" inputmode="numeric" value="${esc(v ?? '')}">`;
  else if (type === 'bool') inp = `<label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input name="${k}" type="checkbox" style="width:auto" ${v ? 'checked' : ''}> 是</label>`;
  else if (type === 'acct') inp = accSelect(k, v);
  else if (type === 'card') inp = accSelect(k, v, 'name', ['card']);
  else if (type === 'kind') inp = `<select name="${k}">${opt(Object.entries(KINDS))}</select>`;
  else if (type === 'mode') inp = `<select name="${k}">${opt([['fixed', '固定金額'], ['remainder', 'App 算好：帳戶餘額扣掉要留的錢']])}</select>`;
  else if (type === 'when') inp = `<select name="${k}">${opt([['payday', '發薪日'], ['payday+1', '發薪隔天'], ['day', '每月固定日']])}</select>`;
  else if (type === 'shift') inp = `<select name="${k}">${opt([['none', '不調整'], ['before', '提前到上一個上班日'], ['after', '延後到下一個上班日']])}</select>`;
  else if (type === 'atype') inp = `<select name="${k}">${opt([['bank', '銀行'], ['cash', '現金'], ['card', '信用卡']])}</select>`;
  else if (type === 'cat') inp = `<select name="${k}">${opt(C.categories.map(c => [c.name, `${c.emoji} ${c.name}`]))}</select>`;
  else if (type === 'days') inp = `<input name="${k}" inputmode="numeric" value="${esc((v || []).join(','))}">`;
  else inp = `<input name="${k}" value="${esc(v ?? '')}">`;
  return `<div class="field"><label>${label}</label>${inp}</div>`;
}
function readFields(form, fields, obj) {
  for (const [k, , type] of fields) {
    const el = form.elements[k]; if (!el) continue;
    if (type === 'num') obj[k] = el.value === '' ? 0 : +el.value;
    else if (type === 'bool') obj[k] = el.checked;
    else if (type === 'days') obj[k] = el.value.split(/[,，、\s]+/).map(Number).filter(n => n >= 1 && n <= 31);
    else obj[k] = el.value;
  }
  return obj;
}
function openEditor(type, i) {
  const E = EDIT[type], isNew = i == null, r = isNew ? E.blank() : JSON.parse(JSON.stringify(C[type][i]));
  sheet(`<div class="head"><a class="muted" data-act="close">取消</a><b>${isNew ? '新增' : '編輯'}${E.title}</b><a class="link" data-act="ed-save">儲存</a></div><form id="edf">${E.fields.map(f => fieldInput(f, r[f[0]])).join('')}</form>${isNew ? '' : '<button class="btn danger" data-act="ed-del">刪除</button>'}`);
  modalCtx = { type, i, r, E };
}

// ---------- 彈出視窗 ----------
let modalCtx = null;
function sheet(html, cls = '') { const m = $('#modal'), keep = cls && m.firstChild && m.firstChild.classList.contains(cls) ? m.firstChild.scrollTop : 0; m.innerHTML = `<div class="sheet ${cls}">${html}</div>`; m.hidden = false; m.firstChild.scrollTop = keep; }
function closeSheet() { $('#modal').hidden = true; $('#modal').innerHTML = ''; modalCtx = null; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeSheet(); });
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2200); }
function ask(title, fields, okText = '確定') {
  return new Promise(res => {
    sheet(`<div class="head"><a class="muted" data-act="close">取消</a><b>${title}</b><span style="width:30px"></span></div><form id="askf">${fields.map(f => `<div class="field"><label>${f.label}</label>${f.html || `<input name="${f.name}" type="${f.type || 'text'}" ${f.type === 'number' ? 'inputmode="numeric"' : ''} value="${esc(f.value ?? '')}">`}</div>`).join('')}<button class="btn" type="submit">${okText}</button></form>`);
    modalCtx = { ask: res };
    const f = $('#askf');
    f.addEventListener('submit', e => { e.preventDefault(); const o = {}; for (const el of f.elements) if (el.name) o[el.name] = el.type === 'checkbox' ? el.checked : el.value; modalCtx = null; closeSheet(); res(o); });
    setTimeout(() => { const first = f.querySelector('input'); if (first && first.type !== 'date') first.focus(); }, 50);
  });
}

// ---------- 記一筆 ----------
let AE = null;
function openAdd(preset = {}) {
  const cash = C.accounts.find(a => a.type === 'cash');
  AE = Object.assign({ mode: 'expense', amount: '', from: cash ? cash.id : (C.accounts[0] || {}).id, to: '', category: (C.categories[0] || {}).name || '其他', note: '', date: TODAY, jar: '', nextCycle: false }, preset);
  drawAdd();
}
function drawAdd() {
  const m = AE.mode, chip = (val, cur, label, act) => `<button class="chip ${val === cur ? 'on' : ''}" data-act="${act}" data-v="${esc(val)}">${label}</button>`;
  const accs = (types) => C.accounts.filter(a => !types || types.includes(a.type));
  let h = `<div class="head"><a class="muted" data-act="close">取消</a><b>記一筆</b><a class="link" data-act="paste">📋 貼上匯入</a></div>
  <div class="seg">${[['expense', '支出'], ['withdraw', '領現金'], ['income', '收入'], ['transfer', '互轉'], ['invest', '投資']].map(([v, l]) => `<button class="${m === v ? 'on' : ''}" data-act="ae-mode" data-v="${v}">${l}</button>`).join('')}</div>
  <div class="bigamt">$ ${AE.amount ? fmt(+AE.amount) : '0'}</div>
  <div class="muted" style="text-align:center"><input type="date" value="${AE.date}" data-ae="date" style="width:auto;display:inline-block;padding:4px 8px;font-size:13px"></div>`;
  if (m === 'expense' || m === 'invest') {
    h += `<div class="field"><label>從哪裡付</label><div class="chips">${accs(['cash', 'card', 'bank']).map(a => chip(a.id, AE.from, `${a.type === 'cash' ? '👛 ' : a.type === 'card' ? '💳 ' : ''}${esc(a.name)}`, 'ae-from')).join('')}</div></div>`;
  }
  if ((m === 'expense' || m === 'invest') && acc(AE.from).type === 'card') {
    const cd = cardOf(AE.from);
    h += `<label class="card" style="display:flex;gap:10px;align-items:center;padding:10px 12px;margin-top:8px"><input type="checkbox" style="width:auto" data-ae-check="nextCycle" ${AE.nextCycle ? 'checked' : ''}><span class="grow">⏭️ 算下一期帳單<br><span class="muted small">店家還沒請款、這期帳單不會有這筆${cd ? `（${cd.closeDay} 日結帳）` : ''}</span></span></label>`;
  }
  if (m === 'expense') {
    h += `<div class="field"><label>類別（點一下就選好）</label><div class="chips">${C.categories.map(c => chip(c.name, AE.category, `${esc(c.emoji)} ${esc(c.name)}`, 'ae-cat')).join('')}</div></div>`;
    h += `<div class="field"><label>直接從分割帳戶（罐子）付（可不選，選了就不扣上面的帳戶）</label><div class="chips">${chip('', AE.jar, '不是', 'ae-jar')}${C.jars.map(j => chip(j.id, AE.jar, `${esc(j.emoji)} ${esc(j.name)}`, 'ae-jar')).join('')}</div></div>`;
  }
  if (m === 'withdraw' || m === 'transfer') {
    h += `<div class="field"><label>從哪個帳戶</label><div class="chips">${accs(['bank']).map(a => chip(a.id, AE.from, esc(a.name), 'ae-from')).join('')}</div></div>`;
  }
  if (m === 'transfer') {
    h += `<div class="field"><label>轉到哪個帳戶</label><div class="chips">${accs(['bank', 'cash', 'card']).map(a => chip(a.id, AE.to, esc(a.name), 'ae-to')).join('')}</div></div>`;
  }
  if (m === 'income') {
    h += `<div class="field"><label>進哪個帳戶</label><div class="chips">${accs(['bank', 'cash']).map(a => chip(a.id, AE.to, esc(a.name), 'ae-to')).join('')}</div></div>
    <div class="field"><label>類別</label><div class="chips">${['差旅', '其他收入'].map(c => chip(c, AE.category, `${SYS_CATS[c]} ${c}`, 'ae-cat')).join('')}</div></div>`;
  }
  h += `<div class="field"><input placeholder="備註（可不填）" value="${esc(AE.note)}" data-ae="note"></div>
  <div class="keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'].map(x => `<button data-act="key" data-v="${x}">${x}</button>`).join('')}</div>
  <button class="btn" data-act="ae-save">儲存</button>`;
  sheet(h, 'addsheet');
}
function saveAdd() {
  const a = +AE.amount;
  if (!a) return toast('請輸入金額');
  const m = AE.mode, t = { id: uid(), date: AE.date || TODAY, amount: a, note: AE.note.trim(), created: new Date().toISOString() };
  if (m === 'expense') { if (!AE.from) return toast('請選擇從哪裡付'); Object.assign(t, { kind: 'expense', from: AE.from, category: AE.category }); if (AE.jar) t.jar = AE.jar; if (AE.nextCycle && acc(AE.from).type === 'card' && !AE.jar) t.nextCycle = true; }
  else if (m === 'invest') { if (!AE.from) return toast('請選擇帳戶'); Object.assign(t, { kind: 'invest', from: AE.from, category: '投資' }); }
  else if (m === 'withdraw') {
    const cash = C.accounts.find(x => x.type === 'cash'); if (!cash) return toast('請先新增現金帳戶');
    if (!AE.from) return toast('請選擇從哪個帳戶領'); Object.assign(t, { kind: 'transfer', from: AE.from, to: cash.id, note: t.note || '領現金' });
  } else if (m === 'transfer') { if (!AE.from || !AE.to || AE.from === AE.to) return toast('請選擇兩個不同帳戶'); Object.assign(t, { kind: 'transfer', from: AE.from, to: AE.to }); }
  else if (m === 'income') { if (!AE.to) return toast('請選擇進哪個帳戶'); Object.assign(t, { kind: 'income', to: AE.to, category: AE.category || '其他收入' }); }
  D.tx.push(t);
  if (t.jar) { t.from = ''; D.tx.push({ id: uid(), date: t.date, kind: 'jar', jar: t.jar, amount: -a, note: `拿出來用：${t.note || t.category}`, link: t.id, noAcct: true }); }
  save(); closeSheet(); render(); toast(`已記下 ${fmt(a)}`);
}

// ---------- 貼上匯入（Claude 讀截圖後產生的文字） ----------
// 格式：日期,帳戶,金額,類別,備註,標記   金額負數＝退款；標記「下一期」＝算下一期帳單
let PI = null;
const normName = x => String(x || '').replace(/\s+/g, '').toLowerCase();
function findAcc(name) {
  const n = normName(name); if (!n) return null;
  return C.accounts.find(a => normName(a.name) === n) || C.accounts.find(a => normName(a.name).includes(n) || n.includes(normName(a.name))) || null;
}
function parseDate(x) {
  x = String(x || '').trim().replace(/[.\/]/g, '-');
  let m = x.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = x.match(/^(\d{2,3})-(\d{1,2})-(\d{1,2})$/); // 民國年
  if (m) return `${+m[1] + 1911}-${pad(+m[2])}-${pad(+m[3])}`;
  m = x.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m) { let y = +TODAY.slice(0, 4), s = `${y}-${pad(+m[1])}-${pad(+m[2])}`; if (s > addDays(TODAY, 1)) s = `${y - 1}-${pad(+m[1])}-${pad(+m[2])}`; return s; }
  return null;
}
function parsePaste(text) {
  const rows = [];
  for (let line of String(text).split(/\r?\n/)) {
    line = line.replace(/^```.*$/, '').trim();
    if (!line || line.startsWith('#') || /^日期[,，\t]/.test(line)) continue;
    const f = line.split(/\t|,|，/).map(x => x.trim());
    const date = parseDate(f[0]), a = findAcc(f[1]), amount = +String(f[2] || '').replace(/[^\d.\-]/g, '');
    const cat = f[3] && (C.categories.some(c => c.name === f[3]) || SYS_CATS[f[3]]) ? f[3] : '其他';
    const r = { raw: line, date, from: a ? a.id : '', amount, category: cat, note: f[4] || '', nextCycle: /下一期/.test(f[5] || ''), on: true, err: '' };
    if (!date) r.err = '日期看不懂'; else if (!a) r.err = `找不到帳戶「${f[1] || ''}」`; else if (!amount) r.err = '金額看不懂';
    if (r.err) r.on = false;
    else r.dup = D.tx.some(t => t.kind === 'expense' && t.from === r.from && t.date === r.date && Math.abs(+t.amount) === Math.abs(r.amount));
    // 同一次貼上的資料裡也檢查：多張截圖重疊時，同日期＋同帳戶＋同金額＋同店家只留第一筆
    if (!r.err && !r.dup && rows.some(x => !x.err && x.date === r.date && x.from === r.from && x.amount === r.amount && normName(x.note) === normName(r.note))) r.dup = 'batch';
    if (r.dup) r.on = false;
    rows.push(r);
  }
  return rows;
}
function drawPaste() {
  let h = `<div class="head"><a class="muted" data-act="close">取消</a><b>📋 貼上匯入</b><span style="width:30px"></span></div>`;
  if (!PI.rows) {
    h += `<p class="muted" style="margin-top:6px">把 Claude 整理好的文字整段貼進來，一筆一行：<br><code>日期,帳戶,金額,類別,備註,標記</code><br>金額負數＝退款；標記寫「下一期」＝算下一期帳單</p>
    <textarea id="pastebox" rows="9" style="margin-top:10px;font-size:13px" placeholder="2026-11-18,CUBE 卡,800,餐飲,全家,下一期">${esc(PI.text || '')}</textarea>
    <div class="row" style="margin-top:10px"><button class="btn ghost" style="margin:0" data-act="paste-clip">從剪貼簿貼上</button><button class="btn" style="margin:0" data-act="paste-parse">下一步：預覽</button></div>`;
  } else {
    const ok = PI.rows.filter(r => r.on), tot = sum(ok, r => r.amount);
    h += `<p class="muted" style="margin-top:6px">打勾的會匯入。標「已經記過」或「截圖重疊」的預設不勾；真的是兩筆一樣的消費（例如同一天買兩杯一樣的咖啡），自己勾回來就好</p><div class="card tight">`;
    PI.rows.forEach((r, i) => {
      h += `<div class="item" style="align-items:flex-start"><input type="checkbox" style="width:auto;margin-top:4px" data-pi="${i}" data-pf="on" ${r.on ? 'checked' : ''} ${r.err ? 'disabled' : ''}>
      <div class="grow">${r.err ? `<div class="muted small">${esc(r.raw)}</div><span class="tag red">${esc(r.err)}</span>` : `
        <div class="row"><span>${md(r.date)}・${esc(accName(r.from))}</span><b>${r.amount < 0 ? '退款 ' : ''}${fmt(Math.abs(r.amount))}</b></div>
        <div class="muted small">${esc(r.note)}${r.dup === 'batch' ? ' <span class="tag amber">跟上面重複（截圖重疊）</span>' : r.dup ? ' <span class="tag amber">已經記過</span>' : ''}</div>
        <div class="row" style="margin-top:6px;gap:6px"><select data-pi="${i}" data-pf="category" style="padding:6px 8px;font-size:13px">${C.categories.map(c => `<option ${c.name === r.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}${C.categories.some(c => c.name === r.category) ? '' : `<option selected>${esc(r.category)}</option>`}</select>
        ${acc(r.from).type === 'card' ? `<label class="small" style="display:flex;gap:4px;align-items:center;white-space:nowrap"><input type="checkbox" style="width:auto" data-pi="${i}" data-pf="nextCycle" ${r.nextCycle ? 'checked' : ''}>⏭️ 下一期</label>` : ''}</div>`}
      </div></div>`;
    });
    h += `</div><button class="btn" data-act="paste-go">匯入 ${ok.length} 筆（共 ${fmt(tot)}）</button><button class="btn ghost" data-act="paste-back">回上一步</button>`;
  }
  sheet(h, 'addsheet');
}

// ---------- 交易編輯 ----------
function openTx(id) {
  const t = D.tx.find(x => x.id === id); if (!t) return;
  const nc = t.kind === 'expense' && acc(t.from).type === 'card' ? `<div class="field"><label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" name="nextCycle" style="width:auto" ${t.nextCycle ? 'checked' : ''}> ⏭️ 算下一期帳單（店家還沒請款）</label></div>` : '';
  const catSel = t.kind === 'expense' ? `<div class="field"><label>類別</label><select name="category">${[...C.categories.map(c => c.name), ...Object.keys(SYS_CATS)].filter((v, i, a) => a.indexOf(v) === i).map(c => `<option ${c === t.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>` : '';
  sheet(`<div class="head"><a class="muted" data-act="close">取消</a><b>${esc(KINDS[t.kind] || (t.kind === 'jar' ? '存錢罐' : '對帳調整'))}</b><a class="link" data-act="tx-save">儲存</a></div>
  <form id="txf"><div class="field"><label>金額</label><input name="amount" type="number" inputmode="numeric" value="${Math.abs(t.amount)}"></div>
  <div class="field"><label>日期</label><input name="date" type="date" value="${t.date}"></div>${nc}${catSel}
  <div class="field"><label>備註</label><input name="note" value="${esc(t.note || '')}"></div></form>
  ${t.ref ? '<p class="muted small" style="margin-top:8px">這筆來自清單，刪除等於取消打勾</p>' : ''}<button class="btn danger" data-act="tx-del">刪除這筆</button>`);
  modalCtx = { tx: t };
}

// ---------- 事件 ----------
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, k = el.dataset.k;
  if (el.tagName === 'A' && !el.getAttribute('href')) e.preventDefault();
  switch (act) {
    case 'close': if (modalCtx && modalCtx.ask) modalCtx.ask(null); closeSheet(); break;
    case 'add': openAdd(); break;
    case 'ae-mode': {
      AE.mode = el.dataset.v;
      if (AE.mode === 'withdraw' || AE.mode === 'transfer') { if (acc(AE.from).type !== 'bank') AE.from = (C.accounts.find(a => a.type === 'bank') || {}).id; }
      if (AE.mode === 'income') AE.category = '其他收入';
      if (AE.mode === 'expense') { const cash = C.accounts.find(a => a.type === 'cash'); if (cash) AE.from = cash.id; AE.category = (C.categories[0] || {}).name; }
      drawAdd(); break;
    }
    case 'ae-from': AE.from = el.dataset.v; drawAdd(); break;
    case 'ae-to': AE.to = el.dataset.v; drawAdd(); break;
    case 'ae-cat': AE.category = el.dataset.v; drawAdd(); break;
    case 'ae-jar': AE.jar = el.dataset.v; drawAdd(); break;
    case 'key': {
      const v = el.dataset.v;
      if (v === '⌫') AE.amount = AE.amount.slice(0, -1); else if (AE.amount.length < 8) AE.amount = (AE.amount + v).replace(/^0+/, '');
      $('.bigamt').textContent = `$ ${AE.amount ? fmt(+AE.amount) : '0'}`; break;
    }
    case 'ae-save': saveAdd(); break;
    case 'paste': PI = { text: '', rows: null }; drawPaste(); break;
    case 'paste-clip': try { PI.text = await navigator.clipboard.readText(); drawPaste(); } catch (err) { toast('讀不到剪貼簿，請長按輸入框貼上'); } break;
    case 'paste-parse': PI.text = $('#pastebox').value; PI.rows = parsePaste(PI.text); if (!PI.rows.length) { PI.rows = null; toast('沒有讀到資料'); } drawPaste(); break;
    case 'paste-back': PI.rows = null; drawPaste(); break;
    case 'paste-go': {
      const ok = PI.rows.filter(r => r.on && !r.err);
      for (const r of ok) { const t = { id: uid(), date: r.date, kind: 'expense', from: r.from, amount: r.amount, category: r.category, note: r.note, created: new Date().toISOString(), imported: true }; if (r.nextCycle && acc(r.from).type === 'card') t.nextCycle = true; D.tx.push(t); }
      save(); closeSheet(); render(); toast(`已匯入 ${ok.length} 筆`); break;
    }
    case 'salary': {
      const P = D.periods[k] || {};
      const r = await ask(`${+k.slice(5)} 月薪水`, [{ label: `發薪日 ${mdw(payday(k))}，入 ${esc(accName(C.salary.to))}`, name: 'v', type: 'number', value: P.salary ?? '' }], '儲存');
      if (!r) break;
      D.periods[k] = Object.assign(P, { salary: r.v === '' ? null : +r.v });
      const old = txByRef(`${k}|salary`);
      if (old) { if (r.v === '') D.tx = D.tx.filter(t => t !== old); else old.amount = +r.v; }
      save(); autopost(); render(); break;
    }
    case 'bill': {
      const key = el.dataset.key, [cid, mon] = key.split('|');
      const r = await ask(`${esc(accName(cid))} ${+mon.slice(5)} 月帳單`, [{ label: `App 記到這期刷了 ${fmt(+el.dataset.spend)}，請填帳單上的實際金額`, name: 'v', type: 'number', value: D.bills[key] ?? el.dataset.spend }], '儲存');
      if (!r) break;
      if (r.v === '') delete D.bills[key]; else D.bills[key] = +r.v;
      for (const t of D.tx) if (t.ref && t.ref.includes(`|pay|${cid}`) && !t.edited) { const it = plan(t.ref.split('|')[0]).find(i => i.key === t.ref); if (it && it.billKey === key && r.v !== '') t.amount = +r.v; }
      save(); autopost(); render(); break;
    }
    case 'tick': {
      const key = el.dataset.key, kk = key.split('|')[0], it = plan(kk).find(i => i.key === key);
      if (!it) break;
      if (it.tx) { D.tx = D.tx.filter(t => t !== it.tx); save(); render(); break; }
      let amount = it.amount;
      if (it.mode === 'remainder') {
        const bal = balances(), sug = Math.max(0, (bal[it.from] || 0) - it.reserve);
        const r = await ask(it.title, [{ label: `${esc(accName(it.from))} 現在 ${fmt(bal[it.from])}，留 ${fmt(it.reserve)} 後可以轉`, name: 'v', type: 'number', value: sug }], '轉好了');
        if (!r) break; amount = +r.v;
      }
      if (amount == null) break;
      D.tx.push({ id: uid(), ref: key, src: 'plan', date: TODAY, kind: it.kind, amount, from: it.from, to: it.to, category: it.category, note: it.title });
      save(); render(); break;
    }
    case 'check': case 'check-add': {
      const c = C.checks.find(x => x.id === el.dataset.id), kk = periodOf(TODAY);
      const txs = D.tx.filter(t => t.ref && t.ref.startsWith(`${kk}|c|${c.id}|`));
      if (act === 'check' && txs.length) { D.tx = D.tx.filter(t => !txs.includes(t)); save(); render(); break; }
      D.tx.push({ id: uid(), ref: `${kk}|c|${c.id}|${uid()}`, src: 'check', date: TODAY, kind: 'expense', amount: +c.amount, from: c.from, category: c.category, note: c.name });
      save(); render(); toast(`${c.name} ✓ ${md(TODAY)}`); break;
    }
    case 'tx': openTx(el.dataset.id); break;
    case 'tx-save': {
      const t = modalCtx.tx, f = $('#txf'), v = +f.elements.amount.value;
      t.amount = t.kind === 'jar' || t.kind === 'adjust' ? (t.amount < 0 ? -v : v) : v; t.date = f.elements.date.value || t.date; t.note = f.elements.note.value; t.edited = true;
      if (f.elements.nextCycle) { if (f.elements.nextCycle.checked) t.nextCycle = true; else delete t.nextCycle; }
      if (f.elements.category) t.category = f.elements.category.value;
      const linked = D.tx.find(x => x.link === t.id); if (linked) { linked.amount = -v; linked.date = t.date; }
      save(); closeSheet(); render(); break;
    }
    case 'tx-del': {
      const t = modalCtx.tx;
      if (!confirm('確定刪除這筆？')) break;
      D.tx = D.tx.filter(x => x !== t && x.link !== t.id && !(t.link && x.id === t.link));
      save(); closeSheet(); render(); break;
    }
    case 'bal-save': {
      e.preventDefault();
      const f = $('#balf'), date = f.elements.__date.value || TODAY, bal = balances(date);
      let n = 0;
      for (const a of C.accounts) {
        const el = f.elements[a.id]; if (!el || el.value === '' || el.value === el.dataset.was) continue;
        const want = a.type === 'card' ? -Math.abs(+el.value) : +el.value, delta = want - bal[a.id];
        if (!delta) continue;
        D.tx.push({ id: uid(), date, kind: 'adjust', to: a.id, amount: delta, note: '輸入目前餘額', opening: true });
        D.recon.acc ||= {}; D.recon.acc[a.id] = { date: TODAY, delta: 0 }; n++;
      }
      const jb = jarBalances();
      for (const j of C.jars) {
        const el = f.elements[`jar_${j.id}`]; if (!el || el.value === '' || el.value === el.dataset.was) continue;
        const delta = +el.value - (jb[j.id] || 0);
        if (delta) { D.tx.push({ id: uid(), date, kind: 'jar', jar: j.id, amount: delta, note: '輸入目前金額', noAcct: true, opening: true }); n++; }
      }
      D.recon.last = TODAY;
      save(); location.hash = '#acct'; toast(n ? `已更新 ${n} 個帳戶` : '沒有變動'); break;
    }
    case 'pk': statsKey = k; render(); break;
    case 'recon': {
      const a = acc(el.dataset.id), bal = balances();
      const r = await ask(`${esc(a.name)} 對帳`, [{ label: `App 算的是 ${fmt(bal[a.id])}，銀行／錢包實際是多少？${a.type === 'card' ? '（信用卡請輸入負數，例如還欠 3,000 就輸入 -3000）' : ''}`, name: 'v', type: 'number', value: bal[a.id] }], '對帳');
      if (!r || r.v === '') break;
      const delta = +r.v - bal[a.id];
      if (delta) {
        if (a.type === 'cash' && delta < 0) D.tx.push({ id: uid(), date: TODAY, kind: 'expense', from: a.id, amount: -delta, category: '未記錄小額', note: '對帳：沒記到的小額花費' });
        else D.tx.push({ id: uid(), date: TODAY, kind: 'adjust', to: a.id, amount: delta, note: '對帳調整' });
      }
      D.recon.acc ||= {}; D.recon.acc[a.id] = { date: TODAY, delta }; D.recon.last = TODAY;
      save(); render(); toast(delta ? `差 ${fmt(delta)}，已調整` : '對上了 👍'); break;
    }
    case 'jar-in': case 'jar-out': {
      const out = act === 'jar-out', sv = accName(C.savings);
      const r = await ask(out ? '從分割帳戶拿出來' : `從 ${esc(sv)} 主帳戶存進分割帳戶`, [
        { label: '哪個罐子', name: 'jar', html: `<select name="jar">${C.jars.map(j => `<option value="${j.id}">${esc(j.emoji)} ${esc(j.name)}</option>`).join('')}</select>` },
        { label: '金額', name: 'v', type: 'number' }, { label: '日期', name: 'date', type: 'date', value: TODAY },
        ...(out ? [{ label: '拿出來做什麼', name: 'how', html: `<select name="how"><option value="back">轉回 ${esc(sv)} 主帳戶</option><option value="spend">直接花掉（記一筆支出）</option></select>` },
          { label: '（花掉的話）類別', name: 'cat', html: `<select name="cat">${C.categories.map(c => `<option>${esc(c.name)}</option>`).join('')}</select>` }] : [])
      ], out ? '拿出來' : '存進去');
      if (!r || !+r.v) break;
      const v = +r.v, j = C.jars.find(x => x.id === r.jar), date = r.date || TODAY;
      if (out && r.how === 'spend') {
        const ex = { id: uid(), date, kind: 'expense', from: '', amount: v, category: r.cat, note: j.name, jar: j.id };
        D.tx.push(ex, { id: uid(), date, kind: 'jar', jar: j.id, amount: -v, note: `拿出來用：${r.cat}`, link: ex.id, noAcct: true });
      } else D.tx.push({ id: uid(), date, kind: 'jar', jar: j.id, amount: out ? -v : v, note: out ? `轉回 ${sv}` : `從 ${sv} 存進去` });
      save(); render(); toast(`${j.emoji} ${out ? '拿出' : '存入'} ${fmt(v)}`); break;
    }
    case 'jar-edit': {
      const j = C.jars.find(x => x.id === el.dataset.id);
      const r = await ask('編輯存錢罐', [
        { label: '圖示（一個表情符號）', name: 'emoji', value: j.emoji }, { label: '名稱', name: 'name', value: j.name },
        { label: '目標金額（0＝不設）', name: 'target', type: 'number', value: j.target }, { label: '目標年月（可不設）', name: 'targetDate', type: 'month', value: j.targetDate },
        { label: '顏色', name: 'color', html: `<select name="color">${COLORS.slice(0, 6).map((c, i) => `<option value="${c}" ${c === j.color ? 'selected' : ''}>${['綠', '藍', '橘', '紅', '紫', '青'][i]}</option>`).join('')}</select>` }
      ], '儲存');
      if (!r) break;
      Object.assign(j, { emoji: r.emoji || j.emoji, name: r.name || j.name, target: +r.target || 0, targetDate: r.targetDate || '', color: r.color });
      save(); render(); break;
    }
    case 'ed': openEditor(el.dataset.type, +el.dataset.i); break;
    case 'ed-new': openEditor(el.dataset.type, null); break;
    case 'ed-save': {
      const { type, i, r, E } = modalCtx; readFields($('#edf'), E.fields, r);
      if (type === 'cards' && !r.id) return toast('請先到「帳戶」新增一個種類是信用卡的帳戶');
      if (i == null) C[type].push(r); else C[type][i] = r;
      save(); closeSheet(); autopost(); render(); break;
    }
    case 'ed-del': {
      const { type, i } = modalCtx; if (!confirm('確定刪除？')) break;
      C[type].splice(i, 1); save(); closeSheet(); render(); break;
    }
    case 'export': doExport(); break;
    case 'import': doImport(); break;
    case 'reset': if (confirm('確定清除這支手機上的所有記帳資料？建議先匯出備份。') && confirm('真的要清除嗎？清除後無法復原')) { localStorage.removeItem(KEY); S = null; render(); } break;
    case 'demo': S = demoState(); bind(); save(); location.hash = '#home'; autopost(); render(); break;
    case 'blank': fresh(defaultConfig()); location.hash = '#home'; render(); break;
    case 'cal': toast('下載中…'); refreshCal(true).then(ok => toast(ok ? '已更新行事曆' : '下載失敗，請確認網路')); break;
  }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.alert) { const c = cardOf(el.dataset.alert); c.alert = +el.value; $(`#al-${c.id}`).textContent = fmt(c.alert); save(); }
  if (el.dataset.ae) AE[el.dataset.ae] = el.value;
  if (el.dataset.aeCheck) AE[el.dataset.aeCheck] = el.checked;
  if (el.dataset.pi != null && PI && PI.rows) { const r = PI.rows[+el.dataset.pi]; r[el.dataset.pf] = el.type === 'checkbox' ? el.checked : el.value; if (el.dataset.pf === 'on') drawPaste(); }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.cfg) {
    const path = el.dataset.cfg.split('.'); let o = C;
    while (path.length > 1) o = o[path.shift()];
    o[path[0]] = el.type === 'number' ? +el.value : el.value;
    save(); autopost(); render(); toast('已儲存');
  }
  if (el.dataset.payday) { const kk = el.dataset.payday; D.periods[kk] ||= {}; D.periods[kk].payDate = el.value || undefined; save(); render(); toast('已調整發薪日'); }
});

// ---------- 匯出／匯入 ----------
async function doExport() {
  const name = `money-backup-${TODAY}.json`;
  const blob = new Blob([JSON.stringify({ app: 'money', version: 1, exportedAt: new Date().toISOString(), config: C, data: D }, null, 1)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  const done = () => { D.lastExport = TODAY; save(); render(); };
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); done(); toast('已匯出，選「儲存到檔案」或 Google Drive'); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  done(); toast('已下載備份檔');
}
function doImport() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json'; inp.style.display = 'none'; document.body.appendChild(inp);
  let fired = false;
  const onPick = async () => {
    if (fired) return; fired = true;
    const f = inp.files[0]; inp.remove(); if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j.app !== 'money' || !j.config) throw new Error('不是錢錢管家的檔案');
      if (j.data) {
        if (S && !confirm('匯入備份會取代這支手機上現有的資料，確定嗎？')) return;
        S = { config: j.config, data: j.data };
      } else {
        // 只有設定的「初始設定檔」：保留已記的帳
        const cfg = Object.assign(defaultConfig(), j.config);
        if (S) { if (!confirm('套用設定檔？已記的帳會保留')) return; S.config = cfg; }
        else S = { config: cfg, data: { tx: [], periods: {}, bills: {}, recon: {}, lastExport: null } };
      }
      bind(); save(); autopost(); location.hash = '#home'; render(); toast('匯入完成');
    } catch (e) { alert('匯入失敗：' + e.message); }
  };
  inp.addEventListener('change', onPick); inp.addEventListener('input', onPick);
  inp.click();
}

// ---------- 示範資料（假資料） ----------
function demoState() {
  const cfg = defaultConfig();
  cfg.startDate = addDays(TODAY, -60);
  cfg.accounts = [
    { id: 'cash', name: '現金錢包', type: 'cash' }, { id: 'a', name: '薪轉銀行', type: 'bank' }, { id: 'b', name: '數位銀行', type: 'bank' },
    { id: 'c', name: '銀行 C', type: 'bank' }, { id: 'd', name: '證券交割', type: 'bank' }, { id: 'ca', name: '信用卡 A', type: 'card' }, { id: 'cb', name: '信用卡 B', type: 'card' }
  ];
  cfg.salary = { day: 14, to: 'a', remindDay: 11 }; cfg.savings = 'b';
  cfg.rules = [
    { id: 'r1', name: '薪轉銀行 → 數位銀行', kind: 'transfer', amount: 25000, from: 'a', to: 'b', when: 'payday', auto: false },
    { id: 'r2', name: '家用', kind: 'expense', amount: 6000, from: 'b', category: '家用', when: 'payday', auto: false },
    { id: 'r3', name: '數位銀行 → 證券交割', kind: 'transfer', amount: 15000, from: 'b', to: 'd', when: 'payday', auto: false },
    { id: 'r4', name: '薪轉銀行 → 數位銀行（剩下的）', kind: 'transfer', mode: 'remainder', reserve: 15000, from: 'a', to: 'b', when: 'payday+1', auto: false },
    { id: 'r5', name: '自動轉帳', kind: 'transfer', amount: 15000, from: 'a', to: 'c', when: 'day', day: 18, shift: 'after', auto: true },
    { id: 'r6', name: '固定轉入', kind: 'income', amount: 1000, to: 'a', category: '其他收入', when: 'day', day: 20, shift: 'before', auto: true }
  ];
  cfg.cards = [{ id: 'ca', closeDay: 12, payDay: 27, payFrom: 'c', alert: 12000 }, { id: 'cb', closeDay: 19, payDay: 6, payFrom: 'b', alert: 15000 }];
  cfg.checks = [{ id: 'k1', name: '健身課', amount: 6000, from: 'b', category: '運動' }, { id: 'k2', name: '悠遊卡儲值', amount: 500, from: 'a', category: '交通', multi: true }];
  cfg.dca = [{ id: 'x1', account: 'd', code: '0050', name: '', amount: 3000, days: [6, 16, 26] }, { id: 'x2', account: 'd', code: '00878', name: '', amount: 1000, days: [9, 23], variable: true }];
  cfg.jars[0].target = 100000; cfg.jars[1].target = 50000; cfg.jars[1].targetDate = `${+TODAY.slice(0, 4) + 1}-11`;
  const st = { config: cfg, data: { tx: [], periods: {}, bills: {}, recon: {}, lastExport: addDays(TODAY, -3) } };
  const tx = st.data.tx, start = cfg.startDate;
  tx.push({ id: uid(), date: start, kind: 'adjust', to: 'a', amount: 20000, note: '期初' }, { id: uid(), date: start, kind: 'adjust', to: 'b', amount: 40000, note: '期初' }, { id: uid(), date: start, kind: 'adjust', to: 'c', amount: 3000, note: '期初' }, { id: uid(), date: start, kind: 'adjust', to: 'd', amount: 2000, note: '期初' }, { id: uid(), date: start, kind: 'adjust', to: 'cash', amount: 800, note: '期初' });
  tx.push({ id: uid(), date: start, kind: 'jar', jar: 'j1', amount: 30000, note: '存進去' }, { id: uid(), date: start, kind: 'jar', jar: 'j2', amount: 8000, note: '存進去' });
  const cats = ['餐飲', '餐飲', '餐飲', '交通', '生活', '娛樂', '餐飲'];
  let seed = 7, flip = 0; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let d = start; d <= TODAY; d = addDays(d, 1)) {
    if (rnd() < .8) tx.push({ id: uid(), date: d, kind: 'expense', from: 'cash', amount: Math.round(80 + rnd() * 200), category: cats[Math.floor(rnd() * cats.length)], note: '' });
    if (rnd() < .25) tx.push({ id: uid(), date: d, kind: 'expense', from: (flip++ % 2) ? 'ca' : 'cb', amount: Math.round(300 + rnd() * 1500), category: (flip % 3) ? '生活' : '娛樂', note: '' });
    if (dow(d) === 1) tx.push({ id: uid(), date: d, kind: 'transfer', from: 'a', to: 'cash', amount: 2000, note: '領現金' });
  }
  S = st; bind();
  for (let k = periodOf(start); k <= periodOf(TODAY); k = nextMonth(k)) {
    D.periods[k] = { salary: 70000 + Math.round(rnd() * 5) * 1000 };
    for (const it of plan(k)) {
      if (it.kind === 'bill' && it.date <= TODAY && it.date < addDays(TODAY, -2)) D.bills[it.billKey] = Math.round(6000 + rnd() * 6000);
    }
    for (const it of plan(k)) if (!it.auto && it.date < TODAY && it.kind !== 'bill' && it.date >= start) {
      const amt = it.mode === 'remainder' ? 20000 : it.amount; if (amt == null) continue;
      tx.push({ id: uid(), ref: it.key, src: 'plan', date: it.date, kind: it.kind, amount: amt, from: it.from, to: it.to, category: it.category, note: it.title });
    }
    tx.push({ id: uid(), date: range(k).start, kind: 'jar', jar: 'j2', amount: 2000, note: '存進去' });
  }
  return S;
}

// ---------- 啟動 ----------
if (S) { bind(); autopost(); }
render();
refreshCal(false);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
// 跨日時自動更新
document.addEventListener('visibilitychange', () => { if (!document.hidden && !params.get('today')) { const t = ymd(new Date()); if (t !== TODAY) { TODAY = t; if (S) autopost(); render(); } } });
