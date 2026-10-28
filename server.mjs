import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomInt, randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
mkdirSync(DATA, { recursive: true });
const pinFile = path.join(DATA, 'moderation.pin');
if (!process.env.ADMIN_PIN && !existsSync(pinFile)) writeFileSync(pinFile, String(randomInt(100000, 1000000)), { mode: 0o600 });
const PIN = process.env.ADMIN_PIN || readFileSync(pinFile, 'utf8').trim();
const sessions = new Set();
const attempts = new Map();
const db = new DatabaseSync(path.join(DATA, 'feedback.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS polls (code TEXT PRIMARY KEY, question TEXT NOT NULL, open INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS options (id INTEGER PRIMARY KEY, poll TEXT NOT NULL REFERENCES polls(code), label TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS votes (poll TEXT NOT NULL REFERENCES polls(code), voter TEXT NOT NULL, option_id INTEGER NOT NULL REFERENCES options(id), PRIMARY KEY(poll, voter));`);

const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=')).filter(x => x.length === 2));
const isHost = req => sessions.has(cookies(req).moderator);
const validCode = code => typeof code === 'string' && /^[A-Z2-9]{5}$/.test(code);
function snapshot(code) {
  const poll = db.prepare('SELECT * FROM polls WHERE code=?').get(code);
  if (!poll) throw Error('Diese Abstimmung gibt es nicht.');
  const options = db.prepare('SELECT o.id, o.label, COUNT(v.voter) AS votes FROM options o LEFT JOIN votes v ON v.option_id=o.id AND v.poll=o.poll WHERE o.poll=? GROUP BY o.id ORDER BY o.id').all(code);
  return { ...poll, open: Boolean(poll.open), options, total: options.reduce((sum, o) => sum + o.votes, 0) };
}
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function body(req) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 12000) throw Error('Die Eingabe ist zu lang.'); }
  return JSON.parse(data || '{}');
}
function setCookie(req, res, name, value) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secure}`);
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res, { error: 'Diese Anfrage ist nicht erlaubt.' }, 403);
    if (req.method === 'GET' && url.pathname === '/health') return json(res, { ok: true });
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const ip = req.socket.remoteAddress;
      const a = attempts.get(ip) || { count: 0, since: Date.now() };
      if (Date.now() - a.since > 60000) { a.count = 0; a.since = Date.now(); }
      attempts.set(ip, a);
      if (++a.count > 15) return json(res, { error: 'Bitte eine Minute warten.' }, 429);
      const data = await body(req);
      if (String(data.pin) !== PIN) return json(res, { error: 'Die PIN stimmt noch nicht.' }, 401);
      const token = randomBytes(24).toString('hex'); sessions.add(token); setCookie(req, res, 'moderator', token);
      return json(res, { ok: true });
    }
    if (url.pathname === '/api/host/polls') {
      if (!isHost(req)) return json(res, { error: 'Bitte mit deiner Moderations-PIN anmelden.' }, 401);
      if (req.method === 'GET') return json(res, db.prepare('SELECT code FROM polls ORDER BY rowid DESC').all().map(p => snapshot(p.code)));
      if (req.method === 'POST') {
        const data = await body(req);
        const question = typeof data.question === 'string' ? data.question.trim() : '';
        const options = Array.isArray(data.options) ? data.options.map(x => typeof x === 'string' ? x.trim() : '') : [];
        if (!question || question.length > 180 || options.length < 2 || options.length > 6 || options.some(x => !x || x.length > 80) || new Set(options).size !== options.length) throw Error('Eine Frage und zwei bis sechs unterschiedliche Antworten sind nötig.');
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code;
        do { code = Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (db.prepare('SELECT code FROM polls WHERE code=?').get(code));
        db.exec('BEGIN');
        try {
          db.prepare('INSERT INTO polls(code,question) VALUES(?,?)').run(code, question);
          const insert = db.prepare('INSERT INTO options(poll,label) VALUES(?,?)');
          options.forEach(label => insert.run(code, label)); db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        return json(res, snapshot(code), 201);
      }
    }
    const toggle = url.pathname.match(/^\/api\/host\/polls\/([A-Z2-9]{5})$/);
    if (toggle && req.method === 'POST') {
      if (!isHost(req)) return json(res, { error: 'Bitte als Moderation anmelden.' }, 401);
      const data = await body(req); snapshot(toggle[1]);
      if (typeof data.open !== 'boolean') throw Error('Status fehlt.');
      db.prepare('UPDATE polls SET open=? WHERE code=?').run(data.open ? 1 : 0, toggle[1]);
      publish(toggle[1]); return json(res, snapshot(toggle[1]));
    }
    const poll = url.pathname.match(/^\/api\/polls\/([A-Z2-9]{5})$/);
    if (poll && req.method === 'GET') {
      const state = snapshot(poll[1]);
      const vote = db.prepare('SELECT option_id FROM votes WHERE poll=? AND voter=?').get(poll[1], cookies(req).voter || '');
      return json(res, { ...state, myVote: vote?.option_id ?? null });
    }
    if (req.method !== 'GET') return json(res, { error: 'Nicht gefunden.' }, 404);
    // Die Workshop-Checkliste liegt neben dem App-Repo und bleibt lokal.
    if (url.pathname === '/ablauf' || url.pathname === '/ablauf/') {
      const file = path.join(ROOT, '../ablauf/index.html');
      if (!existsSync(file)) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(readFileSync(file));
    }
    const pages = ['/', '/host'];
    const appPage = pages.includes(url.pathname) || /^\/(p|r)\/[A-Z2-9]{5}$/.test(url.pathname);
    const assets = { '/style.css': 'text/css', '/app.js': 'text/javascript', '/fonts/roboto-latin-wght-normal.woff2': 'font/woff2' };
    if (!appPage && !assets[url.pathname]) return res.writeHead(404).end('Nicht gefunden');
    if (appPage && !/^[a-f0-9-]{36}$/.test(cookies(req).voter || '')) setCookie(req, res, 'voter', randomUUID());
    const file = path.join(ROOT, 'public', appPage ? 'index.html' : url.pathname.slice(1));
    res.writeHead(200, { 'Content-Type': (appPage ? 'text/html' : assets[url.pathname]) + '; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(file));
  } catch (e) { json(res, { error: e.message || 'Das hat nicht geklappt.' }, 400); }
});

const io = new Server(server, {
  maxHttpBufferSize: 16000,
  allowRequest: (req, done) => done(null, !req.headers.origin || [`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin))
});
function publish(code) { io.to(code).emit('poll:update', snapshot(code)); }
function presence(code) {
  if (!code) return;
  const ids = io.sockets.adapter.rooms.get(code) || new Set();
  const devices = new Set([...ids].map(id => cookies(io.sockets.sockets.get(id).request).voter || id));
  io.to(code).emit('poll:presence', { devices: devices.size });
}
io.on('connection', socket => {
  socket.on('poll:join', (code, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    try {
      if (!validCode(code)) throw Error('Bitte den fünfstelligen Code eingeben.');
      const state = snapshot(code);
      if (socket.data.code) { const old = socket.data.code; socket.leave(old); presence(old); }
      socket.data.code = code; socket.join(code); ack({ ok: true, poll: state }); presence(code);
    } catch (e) { ack({ ok: false, error: e.message }); }
  });
  socket.on('poll:vote', (data, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    try {
      const code = data?.code; const voter = cookies(socket.request).voter;
      if (!validCode(code) || code !== socket.data.code || !/^[a-f0-9-]{36}$/.test(voter || '')) throw Error('Bitte die Abstimmung erneut öffnen.');
      if (!snapshot(code).open) throw Error('Diese Abstimmung ist geschlossen.');
      if (!Number.isSafeInteger(data.option) || !db.prepare('SELECT id FROM options WHERE id=? AND poll=?').get(data.option, code)) throw Error('Diese Antwort gibt es nicht.');
      db.prepare('INSERT INTO votes(poll,voter,option_id) VALUES(?,?,?) ON CONFLICT(poll,voter) DO UPDATE SET option_id=excluded.option_id').run(code, voter, data.option);
      publish(code); ack({ ok: true, myVote: data.option });
    } catch (e) { ack({ ok: false, error: e.message }); }
  });
  socket.on('disconnect', () => presence(socket.data.code));
});
const host = process.env.HOST || '0.0.0.0';
server.listen(PORT, host, () => {
  console.log(`\nPULS läuft auf http://localhost:${PORT}\nModeration: http://localhost:${PORT}/host\nModerations-PIN: ${PIN}\n`);
});
function shutdown() { io.close(); server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
