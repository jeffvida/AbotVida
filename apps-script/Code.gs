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
const PUBLIC_SETTINGS = ['shopName', 'tagline', 'logo', 'messengerUrl', 'penaltyEn', 'showSocial'];
const DEFAULT_SETTINGS = { shopName: 'AbotVida', tagline: 'Mas abot, mas saya.', logo: '', messengerUrl: 'https://m.me/', ownerEmail: '', dueSoonDays: 7,
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
      case 'login': return json(login(body));
      case 'logout': return json(logout(body));
      case 'ownerLoad': requireOwner(body); return json({ ok: true, state: readAll() });
      case 'ownerSave': requireOwner(body); return json(ownerSave(body));
      case 'changePassword': requireOwner(body); return json(changePassword(body));
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
  return st;
}

/* ============================== Business rules (same as the website) ============================== */
function dpOf(p) { return p.dpType === 'percent' ? Math.round(p.price * p.dpValue / 100) : +p.dpValue; }
function plan(price, months) { const c = Math.round(price * 100), m = Math.round(c / months), last = c - m * (months - 1); return { monthly: m / 100, last: last / 100 }; }
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
function checkPerson(b) {
  const name = clip(b.name, 80), contact = clip(b.contact, 30);
  if (!name || !contact) fail('errReq');
  if (digits(contact).length < 10) fail('errNum');
  return { name: name, contact: contact, messenger: clip(b.messenger, 200), message: clip(b.message, 600) };
}
function submitQuote(b) {
  const who = checkPerson(b), s = readSettings();
  if (s.penaltyEn && !b.agree) fail('errAgree');
  return withLock(() => {
    const p = readColl('products').filter(x => x.id === b.productId)[0];
    if (!p || p.status === 'Out of stock') fail('errGone');
    const months = +b.months; if ((p.durations || []).indexOf(months) < 0) fail('errGone');
    throttle(digits(who.contact));
    const pl = plan(p.price, months), dp = dpOf(p);
    const rec = Object.assign({ id: 'MQ-' + nextQuoteNo(), createdAt: Date.now() }, who, { productId: p.id, productName: fullName(p), price: p.price,
      months: months, dp: dp, monthly: pl.monthly, last: pl.last, total: round2(dp + p.price), status: 'Pending Review', sample: false, lang: 'en' });
    appendRec('quotes', rec); notifyOwner(rec);
    return { ok: true, quote: rec };
  });
}
function submitCustom(b) {
  const who = checkPerson(b), s = readSettings(), item = clip(b.item, 200);
  if (!item) fail('errItem');
  if (s.penaltyEn && !b.agree) fail('errAgree');
  const months = DURATIONS.indexOf(+b.months) >= 0 ? +b.months : 0;
  return withLock(() => {
    throttle(digits(who.contact));
    const rec = Object.assign({ id: 'MQ-' + nextQuoteNo(), createdAt: Date.now() }, who, { productId: null, productName: item, link: clip(b.link, 500),
      price: 0, months: months, dp: 0, monthly: 0, last: 0, total: 0, status: 'Pending Review', custom: true, sample: false, lang: 'en' });
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
// Optional email to the owner for each new request (uses "Owner email" in Settings).
function notifyOwner(q) {
  try {
    const to = readSettings().ownerEmail; if (!to) return;
    MailApp.sendEmail(to, 'New AbotVida request ' + q.id, [q.name + ' · ' + q.contact, q.productName + (q.months ? ' · ' + q.months + ' months' : ''), q.message ? 'Note: ' + q.message : '', '', 'Open your owner dashboard to review it.'].join('\n'));
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
    if (st.settings) { storeImages('settings', st.settings, images); writeSettings(Object.assign({}, readSettings(), st.settings)); }
    return { ok: true, added: added, images: images, savedAt: Date.now() };
  });
}
// Uploaded photos arrive as data: URLs. Keep them in Drive and save only the link in the sheet.
function storeImages(coll, rec, out) {
  const field = coll === 'settings' ? 'logo' : (coll === 'banners' || coll === 'gallery') ? 'img' : null;
  if (!field) return;
  const v = rec[field]; if (typeof v !== 'string' || v.indexOf('data:') !== 0) return;
  const m = /^data:([\w\/+.-]+);base64,(.*)$/.exec(v); if (!m) return;
  const ext = (m[1].split('/')[1] || 'img').replace('svg+xml', 'svg').replace('jpeg', 'jpg');
  const file = imageFolder().createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], coll + '-' + (rec.id || 'logo') + '-' + Date.now() + '.' + ext));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  rec[field] = imageUrl(file.getId());
  out.push({ coll: coll, id: rec.id || null, field: field, url: rec[field] });
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
