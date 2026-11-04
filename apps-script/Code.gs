/**
 * AbotVida backend — Google Sheets + Apps Script
 * ------------------------------------------------
 * Paste this whole file into Extensions → Apps Script of your AbotVida Google Sheet.
 * Then reload the sheet and use the "AbotVida" menu:
 *   1. AbotVida → Set up sheets
 *   2. AbotVida → Set owner password
 * Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * Put the Web app URL into API_URL near the top of index.html.
 *
 * The "data (do not edit)" column holds each record. The other columns are only
 * there so the sheet is easy to read. Make changes in the owner dashboard, not here.
 */

const VERSION = 1;
const COLLECTIONS = ['products', 'quotes', 'accounts', 'reviews', 'notes', 'cards', 'banners', 'gallery'];
const DURATIONS = [1, 2, 3, 6, 9, 12, 18, 24];
const TOKEN_DAYS = 30;              // how long the owner stays signed in on a device
const MAX_FAILS = 8;                // wrong passwords before a 15-minute lockout
const IMAGE_FOLDER = 'AbotVida images';
const TZ = 'Asia/Manila';           // dates for reminders
const LOG_TAB = 'Reminder log';
const imageUrl = id => 'https://lh3.googleusercontent.com/d/' + id;

/* Sheet layout: readable columns first, record JSON last. */
const LAYOUT = {
  products: { tab: 'Products', cols: ['ID', 'Name', 'Brand', 'Category', 'Item price', 'Service charge', 'Terms (months)', 'Status', 'Hot pick'],
    row: p => [p.id, p.name, p.brand, p.category, p.price, p.dpType === 'percent' ? p.dpValue + '%' : p.dpValue, (p.durations || []).join(', '), p.status, p.hot ? 'Yes' : ''] },
  quotes: { tab: 'Requests', cols: ['ID', 'Received', 'Name', 'Contact', 'Item', 'Months', 'Monthly', 'Total', 'Status'],
    row: q => [q.id, q.createdAt ? new Date(q.createdAt) : '', q.name, q.contact, q.productName, q.months || '', q.monthly || '', q.total || '', q.status] },
  accounts: { tab: 'Accounts', cols: ['ID', 'Customer', 'Contact', 'Item', 'Item price', 'Months', 'Monthly', 'Paid so far', 'Balance', 'Cancelled'],
    row: a => { const paid = (a.schedule || []).reduce((s, i) => s + (+i.paid || 0), 0);
      return [a.id, (a.customer || {}).name, (a.customer || {}).contact, a.productName, a.price, a.months, a.monthly, round2(paid), round2(a.price - paid), a.cancelled ? 'Yes' : '']; } },
  reviews: { tab: 'Reviews', cols: ['ID', 'Received', 'Name', 'Rating', 'Status', 'Review'],
    row: r => [r.id, r.at ? new Date(r.at) : '', r.name, r.rating, r.status, r.text] },
  notes: { tab: 'Notes', cols: ['ID', 'Written', 'Customer number', 'Note'],
    row: n => [n.id, n.at ? new Date(n.at) : '', n.key, n.text] },
  cards: { tab: 'Cards', cols: ['ID', 'Nickname', 'Last 4'], row: c => [c.id, c.name, "'" + c.last4] },
  banners: { tab: 'Banners', cols: ['ID', 'Title', 'Shown'], row: b => [b.id, b.titleEn, b.visible === false ? '' : 'Yes'] },
  gallery: { tab: 'Photos', cols: ['ID', 'Caption', 'Shown'], row: g => [g.id, g.caption, g.visible === false ? '' : 'Yes'] },
};
const SETTINGS_TAB = 'Settings';
const PUBLIC_SETTINGS = ['shopName', 'tagline', 'logo', 'messengerUrl', 'penaltyEn', 'showSocial', 'shopInfo', 'goodToKnow', 'faq', 'reqTerms'];   // shopInfo: Facebook Page, location, hours, delivery areas, DTI no., privacy email
const DEFAULT_SETTINGS = { shopName: 'AbotVida', tagline: 'Mas abot, mas saya.', logo: '', messengerUrl: 'https://m.me/', ownerEmail: '', dueSoonDays: 7, shopInfo: {},
  penaltyEn: 'A penalty is added for every late payment. Please pay on or before your due date.',
  reminderTemplate: 'Hi {name}, this is a friendly reminder that your installment payment of {amount} is due on {date}. Please message us if you have any questions. Thank you!' };

/* ============================== Web app ============================== */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'catalog';
  try {
    if (action === 'catalog') return json(catalog());
    if (action === 'ping') return json({ ok: true, version: VERSION });
    return json({ ok: false, error: 'unknown' });
  } catch (err) { return json({ ok: false, error: 'server', detail: String(err && err.message || err) }); }
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json({ ok: false, error: 'badRequest' }); }
  try {
    switch (body.action) {
      case 'submitQuote': return json(submitQuote(body));
      case 'submitCustom': return json(submitCustom(body));
      case 'submitReview': return json(submitReview(body));
      case 'balance': return json(checkBalance(body));
      case 'login': return json(login(body));
      case 'logout': return json(logout(body));
      case 'ownerLoad': requireOwner(body); return json({ ok: true, state: readAll() });
      case 'ownerSave': requireOwner(body); return json(ownerSave(body));
      case 'changePassword': requireOwner(body); return json(changePassword(body));
      case 'uploadImage': requireOwner(body); return json(uploadImage(body));
      default: return json({ ok: false, error: 'unknown' });
    }
  } catch (err) {
    if (err && err.code) return json({ ok: false, error: err.code });
    return json({ ok: false, error: 'server', detail: String(err && err.message || err) });
  }
}

function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail(code) { const e = new Error(code); e.code = code; throw e; }
function round2(n) { return Math.round((+n || 0) * 100) / 100; }
function clip(s, n) { return String(s == null ? '' : s).trim().slice(0, n); }
function withLock(fn) { const l = LockService.getScriptLock(); l.waitLock(25000); try { return fn(); } finally { l.releaseLock(); } }

/* ============================== Storage ============================== */
function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheetFor(tab, cols) {
  let sh = ss().getSheetByName(tab);
  if (!sh) { sh = ss().insertSheet(tab); }
  if (cols && sh.getLastRow() === 0) { sh.appendRow(cols); sh.setFrozenRows(1); }
  return sh;
}
function readColl(name) {
  const L = LAYOUT[name], sh = sheetFor(L.tab, L.cols.concat(['data (do not edit)']));
  const n = sh.getLastRow(); if (n < 2) return [];
  const w = L.cols.length + 1, vals = sh.getRange(2, w, n - 1, 1).getValues();
  const out = [];
  vals.forEach(r => { if (r[0] === '' || r[0] == null) return; try { out.push(JSON.parse(r[0])); } catch (e) {} });
  return out;
}
function writeColl(name, list) {
  const L = LAYOUT[name], head = L.cols.concat(['data (do not edit)']), sh = sheetFor(L.tab, head);
  const rows = list.map(rec => { const d = JSON.stringify(rec); if (d.length > 49000) fail('tooBig'); return L.row(rec).map(v => v == null ? '' : v).concat([d]); });
  sh.clearContents();
  sh.getRange(1, 1, 1, head.length).setValues([head]);
  if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
}
function appendRec(name, rec) {
  const L = LAYOUT[name], sh = sheetFor(L.tab, L.cols.concat(['data (do not edit)']));
  const d = JSON.stringify(rec); if (d.length > 49000) fail('tooBig');
  sh.appendRow(L.row(rec).map(v => v == null ? '' : v).concat([d]));
}
function readSettings() {
  const sh = sheetFor(SETTINGS_TAB, ['Setting', 'Value']), n = sh.getLastRow(), out = Object.assign({}, DEFAULT_SETTINGS);
  if (n < 2) return out;
  sh.getRange(2, 1, n - 1, 2).getValues().forEach(([k, v]) => { if (!k) return; try { out[k] = JSON.parse(v); } catch (e) { out[k] = v; } });
  return out;
}
function writeSettings(s) {
  const sh = sheetFor(SETTINGS_TAB, ['Setting', 'Value']);
  const rows = Object.keys(s).map(k => { const v = JSON.stringify(s[k]); if (v.length > 49000) fail('tooBig'); return [k, v]; });
  sh.clearContents(); sh.getRange(1, 1, 1, 2).setValues([['Setting', 'Value']]);
  if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
}
function props() { return PropertiesService.getScriptProperties(); }
// Next request number. Always checked against the sheet, so imported or older numbers are never reused.
function nextQuoteNo() {
  const p = props(); let n = Math.max(1001, +p.getProperty('nextQuote') || 0);
  readColl('quotes').forEach(q => { const m = /^MQ-(\d+)$/.exec(q.id || ''); if (m) n = Math.max(n, +m[1] + 1); });
  p.setProperty('nextQuote', String(n + 1));
  return n;
}
function readAll() {
  const st = { settings: readSettings(), nextQuote: +props().getProperty('nextQuote') || 1001 };
  COLLECTIONS.forEach(c => st[c] = readColl(c));
  st.emailLog = readEmailLog().slice(-400);
  st.reminderStatus = reminderStatus();
  return st;
}

/* ============================== Business rules (same as the website) ============================== */
function dpOf(p) { return p.dpType === 'percent' ? Math.round(p.price * p.dpValue / 100) : +p.dpValue; }
// Monthly = item price ÷ months, rounded UP to the next whole peso; the last month is a little smaller so the total equals the item price.
function plan(price, months) {
  const c = Math.round(price * 100);
  if (months <= 1) return { monthly: c / 100, last: c / 100 };
  let m = Math.ceil(c / months / 100) * 100, last = c - m * (months - 1);
  if (last <= 0) { m = Math.round(c / months); last = c - m * (months - 1); }
  return { monthly: m / 100, last: last / 100 };
}
function fullName(p) { return p.brand ? p.brand + ' ' + p.name : p.name; }
function digits(s) { let d = String(s || '').replace(/\D/g, ''); if (d.indexOf('63') === 0 && d.length === 12) d = '0' + d.slice(2); return d; }

/* ============================== Public ============================== */
function catalog() {
  const s = readSettings(), pub = {};
  PUBLIC_SETTINGS.forEach(k => { if (s[k] !== undefined) pub[k] = s[k]; });
  const sold = {};
  readColl('accounts').forEach(a => { if (!a.cancelled && !a.sample && a.productId) sold[a.productId] = (sold[a.productId] || 0) + 1; });
  return {
    ok: true,
    products: readColl('products'),
    banners: readColl('banners').filter(b => b.visible !== false),
    gallery: readColl('gallery').filter(g => g.visible !== false && g.img),
    reviews: readColl('reviews').filter(r => r.status === 'Approved').map(r => ({ id: r.id, name: r.name, item: r.item, rating: r.rating, text: r.text, at: r.at, status: r.status })),
    settings: pub, sold: sold,
  };
}
// Light protection against spam: at most 6 submissions per number per hour, 300 per hour in total.
function throttle(key) {
  const c = CacheService.getScriptCache();
  [['t_' + key, 6], ['t_all', 300]].forEach(([k, max]) => { const n = +c.get(k) || 0; if (n >= max) fail('errBusy'); c.put(k, String(n + 1), 3600); });
}
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }
function checkPerson(b) {
  const name = clip(b.name, 80), contact = clip(b.contact, 30), email = clip(b.email, 120);
  if (!name || !contact) fail('errReq');
  if (digits(contact).length < 10) fail('errNum');
  if (email && !validEmail(email)) fail('errEmail');
  return { name: name, contact: contact, email: email, messenger: clip(b.messenger, 200), message: clip(b.message, 600) };
}
function submitQuote(b) {
  const who = checkPerson(b), s = readSettings();
  if (s.penaltyEn && !b.agree) fail('errAgree');
  if (!b.privacy) fail('errPrivacy');                 // Data Privacy Act consent
  return withLock(() => {
    const p = readColl('products').filter(x => x.id === b.productId)[0];
    if (!p || p.status === 'Out of stock') fail('errGone');
    const months = +b.months; if ((p.durations || []).indexOf(months) < 0) fail('errGone');
    throttle(digits(who.contact));
    const pl = plan(p.price, months), dp = dpOf(p);
    const rec = Object.assign({ id: 'MQ-' + nextQuoteNo(), createdAt: Date.now() }, who, { productId: p.id, productName: fullName(p), price: p.price,
      months: months, dp: dp, monthly: pl.monthly, last: pl.last, total: round2(dp + p.price), status: 'Pending Review', sample: false, lang: 'en', privacyConsentAt: Date.now() });
    appendRec('quotes', rec); notifyOwner(rec);
    return { ok: true, quote: rec };
  });
}
function submitCustom(b) {
  const who = checkPerson(b), s = readSettings(), item = clip(b.item, 200);
  if (!item) fail('errItem');
  if (s.penaltyEn && !b.agree) fail('errAgree');
  if (!b.privacy) fail('errPrivacy');                 // Data Privacy Act consent
  const months = DURATIONS.indexOf(+b.months) >= 0 ? +b.months : 0;
  return withLock(() => {
    throttle(digits(who.contact));
    const rec = Object.assign({ id: 'MQ-' + nextQuoteNo(), createdAt: Date.now() }, who, { productId: null, productName: item, link: clip(b.link, 500),
      price: 0, months: months, dp: 0, monthly: 0, last: 0, total: 0, status: 'Pending Review', custom: true, sample: false, lang: 'en', privacyConsentAt: Date.now() });
    appendRec('quotes', rec); notifyOwner(rec);
    return { ok: true, quote: rec };
  });
}
function submitReview(b) {
  const rating = Math.round(+b.rating), name = clip(b.name, 40), text = clip(b.text, 1000);
  if (!(rating >= 1 && rating <= 5)) fail('errRate');
  if (!name || text.length < 10) fail('errRev');
  if (!b.ok) fail('errRevOk');
  return withLock(() => {
    throttle('rev_' + name.toLowerCase());
    const rec = { id: 'r' + Utilities.getUuid().slice(0, 8), name: name, item: clip(b.item, 100), rating: rating, text: text, at: Date.now(), status: 'Pending', lang: 'en' };
    appendRec('reviews', rec);
    return { ok: true };
  });
}
// "Check my balance": the customer enters the mobile number they used. Every account on that number that still has
// payments left is sent back, plus requests still being reviewed. Only what the customer needs is included:
// first name, item, amounts and dates. No full name, contact details, notes or card info.
// Lookups are limited (20 per number and 600 in total per hour, and 300 numbers not found per hour) to slow down guessing.
function checkBalance(b) {
  const phone = digits(b.phone).slice(-10);
  if (phone.length < 10) fail('errBalReq');
  const c = CacheService.getScriptCache(), pk = 'bl_' + phone, n = +c.get(pk) || 0, all = +c.get('bl_all') || 0, miss = +c.get('bl_miss') || 0;
  if (n >= 20 || all >= 600 || miss >= 300) fail('errBusy');
  c.put(pk, String(n + 1), 3600); c.put('bl_all', String(all + 1), 3600);
  const mine = x => digits(x).slice(-10) === phone;
  const quotes = readColl('quotes').filter(q => mine(q.contact) && !q.sample);
  const accts = readColl('accounts').filter(a => mine((a.customer || {}).contact) && !a.cancelled && !a.sample);
  if (!quotes.length && !accts.length) { c.put('bl_miss', String(miss + 1), 3600); fail('errBalNone'); }
  const T = todayStr(), soon = +readSettings().dueSoonDays || 7;
  const view = a => {
    const sched = (a.schedule || []).map(it => {
      const amount = +it.amount || 0, paid = +it.paid || 0, d = dayDiff(T, it.due);
      return { n: it.n, due: it.due, amount: amount, paid: round2(paid), status: paid >= amount - 0.001 ? 'Paid' : d < 0 ? 'Overdue' : d <= soon ? 'Due' : 'Upcoming' };
    });
    const paid = round2(sched.reduce((s, i) => s + i.paid, 0)), next = sched.filter(i => i.status !== 'Paid')[0] || null;
    return { ref: a.quoteId, item: a.productName, price: a.price, months: a.months, monthly: a.monthly, paid: paid, balance: round2(a.price - paid),
      status: !next ? 'Fully Paid' : sched.some(i => i.status === 'Overdue') ? 'Overdue' : 'Active',
      next: next ? { n: next.n, due: next.due, amount: round2(next.amount - next.paid), status: next.status } : null, schedule: sched };
  };
  const all2 = accts.map(view), open = all2.filter(a => a.status !== 'Fully Paid');
  const who = (accts[0] && accts[0].customer && accts[0].customer.name) || (quotes[0] && quotes[0].name) || '';
  return { ok: true, firstName: String(who).trim().split(/\s+/)[0] || '', accounts: open, fullyPaid: all2.length - open.length,
    requests: quotes.filter(q => q.status === 'Pending Review').map(q => ({ ref: q.id, item: q.productName, months: q.months || 0, status: q.status })) };
}

// Optional email to the owner for each new request (uses "Owner email" in Settings).
function notifyOwner(q) {
  try {
    const to = readSettings().ownerEmail; if (!to) return;
    MailApp.sendEmail(to, 'New AbotVida request ' + q.id, [q.name + ' · ' + q.contact + (q.email ? ' · ' + q.email : ''), q.productName + (q.months ? ' · ' + q.months + ' months' : ''), q.message ? 'Note: ' + q.message : '', '', 'Open your owner dashboard to review it.'].join('\n'));
  } catch (e) {}
}

/* ============================== Owner login ============================== */
function hash(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8).map(b => ('0' + (b & 255).toString(16)).slice(-2)).join(''); }
function login(b) {
  const p = props(), c = CacheService.getScriptCache(), fails = +c.get('fails') || 0;
  if (fails >= MAX_FAILS) fail('locked');
  const salt = p.getProperty('pwSalt'), h = p.getProperty('pwHash');
  if (!salt || !h) fail('noPassword');
  if (hash(salt + String(b.password || '')) !== h) { c.put('fails', String(fails + 1), 900); fail('wrongPassword'); }
  c.remove('fails');
  const token = Utilities.getUuid() + Utilities.getUuid();
  pruneTokens();
  p.setProperty('tok_' + hash(token), String(Date.now() + TOKEN_DAYS * 864e5));
  return { ok: true, token: token };
}
function logout(b) { if (b.token) props().deleteProperty('tok_' + hash(String(b.token))); return { ok: true }; }
function requireOwner(b) {
  if (!b.token) fail('auth');
  const exp = +props().getProperty('tok_' + hash(String(b.token))) || 0;
  if (exp < Date.now()) fail('auth');
}
function pruneTokens() { const p = props(), all = p.getProperties(), now = Date.now(); Object.keys(all).forEach(k => { if (k.indexOf('tok_') === 0 && +all[k] < now) p.deleteProperty(k); }); }
function setPassword(pw) {
  const salt = Utilities.getUuid(), p = props();
  p.setProperty('pwSalt', salt); p.setProperty('pwHash', hash(salt + pw));
  Object.keys(p.getProperties()).forEach(k => { if (k.indexOf('tok_') === 0) p.deleteProperty(k); });   // signs out every device
}
function changePassword(b) {
  const p = props();
  if (hash(p.getProperty('pwSalt') + String(b.current || '')) !== p.getProperty('pwHash')) fail('wrongPassword');
  if (String(b.next || '').length < 8) fail('shortPassword');
  setPassword(String(b.next));
  return login({ password: String(b.next) });
}

/* ============================== Owner save (merge-safe) ============================== */
// The dashboard sends its full data plus the IDs it last received ("known").
// Records the dashboard never saw (for example a request a customer sent a minute ago) are kept.
// Records it saw and then removed are deleted.
function ownerSave(b) {
  const st = b.state || {}, known = b.known || {};
  return withLock(() => {
    const added = {}, images = [];
    COLLECTIONS.forEach(c => {
      const mine = Array.isArray(st[c]) ? st[c] : null;
      if (!mine && !known[c]) return;
      const ids = {}; (mine || []).forEach(r => ids[r.id] = 1);
      const kn = {}; (known[c] || []).forEach(id => kn[id] = 1);
      const theirs = readColl(c).filter(r => !ids[r.id] && !kn[r.id]);
      if (theirs.length) added[c] = theirs;
      if (!mine) return;                       // not changed by the owner: only report what is new
      mine.forEach(r => storeImages(c, r, images));
      writeColl(c, mine.concat(theirs));
    });
    let status = null;
    if (st.settings) {
      storeImages('settings', st.settings, images);
      const merged = Object.assign({}, readSettings(), st.settings);
      writeSettings(merged);
      if ('autoEmail' in st.settings) { try { setReminderTrigger(!!merged.autoEmail); } catch (e) {} status = reminderStatus(); }
    }
    return { ok: true, added: added, images: images, savedAt: Date.now(), reminderStatus: status };
  });
}
// Uploaded photos arrive as data: URLs. Keep them in Drive and save only the link in the sheet.
function storeImages(coll, rec, out) {
  const field = coll === 'settings' ? 'logo' : (coll === 'banners' || coll === 'gallery') ? 'img' : null;
  if (!field) return;
  const v = rec[field]; if (typeof v !== 'string' || v.indexOf('data:') !== 0) return;
  const url = saveImage(v, coll + '-' + (rec.id || 'logo')); if (!url) return;
  rec[field] = url;
  out.push({ coll: coll, id: rec.id || null, field: field, url: url });
}
// Saves one data: URL image to the Drive folder and returns its public link.
function saveImage(dataUrl, name) {
  const m = /^data:(image\/[\w+.-]+);base64,(.*)$/.exec(dataUrl); if (!m) return '';
  const ext = (m[1].split('/')[1] || 'img').replace('svg+xml', 'svg').replace('jpeg', 'jpg');
  const file = imageFolder().createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], clip(name, 60) + '-' + Date.now() + '.' + ext));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return imageUrl(file.getId());
}
// Product photos uploaded from the dashboard.
function uploadImage(b) {
  const v = String(b.data || '');
  if (v.length > 8000000) fail('tooBig');
  const url = saveImage(v, 'product-' + String(b.name || 'photo').replace(/[^\w-]+/g, '-'));
  if (!url) fail('badImage');
  return { ok: true, url: url };
}
function imageFolder() {
  const p = props(), id = p.getProperty('imageFolder');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder(IMAGE_FOLDER); p.setProperty('imageFolder', f.getId()); return f;
}

/* ============================== Sheet menu ============================== */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('AbotVida')
    .addItem('Set up sheets', 'setupSheets')
    .addItem('Set owner password', 'promptPassword')
    .addItem('Sign out all devices', 'signOutAll')
    .addSeparator()
    .addItem('Set up email reminders', 'menuSetupReminders')
    .addItem('Send email reminders now', 'menuSendReminders')
    .addToUi();
}
function setupSheets() {
  COLLECTIONS.forEach(c => sheetFor(LAYOUT[c].tab, LAYOUT[c].cols.concat(['data (do not edit)'])));
  if (ss().getSheetByName(SETTINGS_TAB) == null || ss().getSheetByName(SETTINGS_TAB).getLastRow() < 2) writeSettings(DEFAULT_SETTINGS);
  const blank = ss().getSheetByName('Sheet1'); if (blank && blank.getLastRow() === 0 && ss().getSheets().length > 1) ss().deleteSheet(blank);
  SpreadsheetApp.getUi().alert('Sheets are ready. Next: AbotVida → Set owner password.');
}
function promptPassword() {
  const ui = SpreadsheetApp.getUi(), r = ui.prompt('Owner password', 'Choose a password for the owner dashboard (at least 8 characters).', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const pw = r.getResponseText();
  if (pw.length < 8) { ui.alert('Use at least 8 characters.'); return; }
  setPassword(pw); ui.alert('Password saved. Any device that was signed in has been signed out.');
}
function signOutAll() { const p = props(); Object.keys(p.getProperties()).forEach(k => { if (k.indexOf('tok_') === 0) p.deleteProperty(k); }); SpreadsheetApp.getUi().alert('All devices are signed out.'); }

/* ============================== Automatic email reminders ============================== */
// Runs every morning (turn it on in the owner dashboard: Settings → Automatic email reminders).
// For each account with a customer email and reminders on, it sends at most one email a day:
//   "soon"    once when the next unpaid payment is within the reminder window (days before)
//   "today"   on the due date
//   "overdue" the day after, then once a week until it is paid
// Every email is written to the "Reminder log" tab, so nobody gets the same reminder twice.
function todayStr() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function dayDiff(a, b) { const x = a.split('-').map(Number), y = b.split('-').map(Number); return Math.round((Date.UTC(y[0], y[1] - 1, y[2]) - Date.UTC(x[0], x[1] - 1, x[2])) / 864e5); }
function prettyDate(s) { const d = s.split('-').map(Number); return Utilities.formatDate(new Date(Date.UTC(d[0], d[1] - 1, d[2], 12)), TZ, 'MMM d, yyyy'); }
function pesoText(n) { const p = round2(n).toFixed(2).split('.'); return '₱' + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (p[1] !== '00' ? '.' + p[1] : ''); }
const LOG_COLS = ['Sent', 'Customer', 'Email', 'Item', 'Payment', 'Due date', 'Type', 'Amount', 'data (do not edit)'];
function readEmailLog() {
  const sh = sheetFor(LOG_TAB, LOG_COLS), n = sh.getLastRow(); if (n < 2) return [];
  return sh.getRange(2, LOG_COLS.length, n - 1, 1).getValues().map(r => { try { return JSON.parse(r[0]); } catch (e) { return null; } }).filter(Boolean);
}
function reminderStatus() {
  let trigger = null, quota = null;
  try { trigger = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'sendReminders'); } catch (e) {}
  try { quota = MailApp.getRemainingDailyQuota(); } catch (e) {}
  return { trigger: trigger, quota: quota, lastRun: +props().getProperty('lastReminderRun') || 0 };
}
function setReminderTrigger(on) {
  const mine = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sendReminders');
  if (on && !mine.length) ScriptApp.newTrigger('sendReminders').timeBased().everyDays(1).atHour(9).inTimezone(TZ).create();
  if (!on) mine.forEach(t => ScriptApp.deleteTrigger(t));
}
function fillTemplate(tpl, name, amount, date) { return String(tpl).split('{name}').join(name).split('{amount}').join(amount).split('{date}').join(date); }
function sendReminders() {
  const s = readSettings(), T = todayStr();
  props().setProperty('lastReminderRun', String(Date.now()));
  if (!s.autoEmail) return { sent: 0, off: true };
  const last = {};
  readEmailLog().forEach(l => { const k = [l.accountId, l.n, l.type, l.due].join('|'); last[k] = Math.max(last[k] || 0, +l.at || 0); });
  const logSheet = sheetFor(LOG_TAB, LOG_COLS);
  let sent = 0, quota = 0; try { quota = MailApp.getRemainingDailyQuota(); } catch (e) {}
  const m = String(s.messengerUrl || '').trim(), msgr = /^https?:\/\/m\.me\/?$/i.test(m) ? '' : m;
  readColl('accounts').forEach(a => {
    if (sent >= quota || a.cancelled || a.sample) return;
    const cu = a.customer || {}, email = clip(cu.email, 120);
    if (!validEmail(email)) return;
    const r = Object.assign({ on: true, daysBefore: null, snoozeUntil: '', message: '' }, a.reminder || {});
    if (r.on === false || (r.snoozeUntil && r.snoozeUntil > T)) return;
    const win = (r.daysBefore == null || r.daysBefore === '') ? (+s.dueSoonDays || 7) : +r.daysBefore;
    const open = (a.schedule || []).filter(i => (+i.paid || 0) < (+i.amount || 0) - 0.001);
    for (let k = 0; k < open.length; k++) {
      const it = open[k], d = dayDiff(T, it.due), key = t => [a.id, it.n, t, it.due].join('|');
      let type = '';
      if (d < 0) { const prev = last[key('overdue')]; if (!prev || Date.now() - prev >= 7 * 864e5 - 3600e3) type = 'overdue'; }
      else if (d === 0) { if (!last[key('today')]) type = 'today'; }
      else if (d <= win) { if (!last[key('soon')]) type = 'soon'; }
      if (!type) { if (d >= 0) break; continue; }
      const first = String(cu.name || '').split(' ')[0] || 'there', due = (+it.amount || 0) - (+it.paid || 0), amount = pesoText(due), date = prettyDate(it.due);
      const subject = type === 'overdue' ? 'Overdue payment: ' + amount + ' was due on ' + date
        : type === 'today' ? 'Your payment of ' + amount + ' is due today' : 'Payment reminder: ' + amount + ' due on ' + date;
      const intro = type === 'overdue'
        ? 'Hi ' + first + ', your installment payment of ' + amount + ' was due on ' + date + ' and we have not received it yet. ' + (s.penaltyEn ? s.penaltyEn + ' ' : '') + 'Please pay as soon as you can, or message us if you need help.'
        : fillTemplate(r.message || s.reminderTemplate || DEFAULT_SETTINGS.reminderTemplate, first, amount, date);
      const lines = [intro, '', 'Item: ' + a.productName, 'Payment ' + it.n + ' of ' + a.months + ': ' + amount + ', due ' + date, 'Pay through GCash, mobile banking or cash.', ''];
      if (msgr) lines.push('Questions? Message us: ' + msgr);
      lines.push(s.shopName || 'AbotVida', '', 'This is an automatic reminder. If you have already paid, thank you, and please ignore this email.');
      try {
        const opt = { to: email, subject: subject, body: lines.join('\n'), name: s.shopName || 'AbotVida' };
        if (validEmail(s.ownerEmail || '')) opt.replyTo = s.ownerEmail;
        MailApp.sendEmail(opt); sent++;
        logSheet.appendRow([new Date(), cu.name, email, a.productName, it.n + ' of ' + a.months, it.due, type, due,
          JSON.stringify({ at: Date.now(), accountId: a.id, n: it.n, due: it.due, type: type, email: email })]);
      } catch (e) {}
      break;   // at most one email per account per day
    }
  });
  return { sent: sent };
}
function menuSetupReminders() {
  setReminderTrigger(true);
  SpreadsheetApp.getUi().alert('Email reminders are set up and checked every morning at about 9 AM. Turn them on or off in the owner dashboard: Settings → Automatic email reminders.');
}
function menuSendReminders() {
  const r = sendReminders();
  SpreadsheetApp.getUi().alert(r.off ? 'Automatic email reminders are off. Turn them on in the owner dashboard: Settings.' : 'Reminder emails sent: ' + r.sent + '.');
}
