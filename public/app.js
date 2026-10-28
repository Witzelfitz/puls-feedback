const app = document.querySelector('#app');
const $ = s => document.querySelector(s);
const socket = io();
let poll, myVote = null, busy = false, deviceCount = 0, noticeTimer;
const code = location.pathname.match(/^\/(p|r)\/([A-Z2-9]{5})$/)?.[2];
const screen = location.pathname.startsWith('/r/');
document.body.classList.toggle('screen', screen);

function el(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
function toast(message) { const t = $('#toast'); t.textContent = message; t.classList.add('show'); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => t.classList.remove('show'), 3500); }
async function api(url, data) {
  const r = await fetch(url, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const value = await r.json(); if (!r.ok) throw Error(value.error || 'Das hat nicht geklappt.'); return value;
}
function intro(kicker, title, description) {
  app.replaceChildren(); app.append(el('div', kicker, 'eyebrow'), el('h1', title));
  if (description) app.append(el('p', description, 'lead'));
}
function home() {
  intro('Deine Meinung zählt', 'Kurz gefragt.\nLive geantwortet.', 'Gib den Code ein und mach mit. Die Ergebnisse entstehen in diesem Moment.');
  $('h1').style.whiteSpace = 'pre-line';
  const form = el('form', undefined, 'join');
  const input = el('input'); input.placeholder = 'CODE'; input.maxLength = 5; input.required = true; input.autocomplete = 'off'; input.setAttribute('aria-label', 'Abstimmungscode');
  const button = el('button', 'Mitmachen ↗'); form.append(input, button);
  form.onsubmit = async e => { e.preventDefault(); const c = input.value.trim().toUpperCase(); try { await api('/api/polls/' + encodeURIComponent(c)); location.href = '/p/' + c; } catch (err) { toast(err.message); } };
  app.append(form, el('p', 'Kein Konto. Kein Name. Einfach abstimmen.', 'muted'));
}
async function host() {
  try {
    const polls = await api('/api/host/polls');
    intro('Moderation', 'Was möchtest du wissen?', 'Eine Frage erstellen, Link teilen und die Stimmen live sehen.');
    const grid = el('div', undefined, 'hostgrid'); const left = el('section'); const form = el('form', undefined, 'form');
    const qlabel = el('label', 'Deine Frage'); qlabel.htmlFor = 'question'; const question = el('input'); question.id = 'question'; question.maxLength = 180; question.required = true; question.value = 'Wie fühlt sich dein KI-Alltag gerade an?';
    const olabel = el('label', 'Antworten · eine pro Zeile'); olabel.htmlFor = 'choices'; const choices = el('textarea'); choices.id = 'choices'; choices.required = true; choices.value = 'Neugierig und voller Ideen\nSchon ziemlich produktiv\nNoch etwas überfordert\nBereit für die nächste Stufe';
    const create = el('button', 'Abstimmung starten ↗'); form.append(qlabel, question, olabel, choices, create);
    form.onsubmit = async e => { e.preventDefault(); create.disabled = true; try { const p = await api('/api/host/polls', { question: question.value, options: choices.value.split('\n').map(x => x.trim()).filter(Boolean) }); location.href = '/r/' + p.code; } catch (err) { toast(err.message); create.disabled = false; } };
    left.append(form); const right = el('section'); right.append(el('h2', 'Deine Abstimmungen'));
    if (!polls.length) right.append(el('p', 'Hier erscheint gleich deine erste Frage.', 'empty'));
    for (const p of polls) {
      const row = el('article', undefined, 'past'); row.append(el('small', p.open ? 'Offen' : 'Geschlossen'), el('h3', p.question), el('p', `${p.total} ${p.total === 1 ? 'Stimme' : 'Stimmen'} · ${p.code}`));
      const actions = el('div', undefined, 'actions'); const a = el('a', 'Ergebnisse öffnen', 'button secondary small'); a.href = '/r/' + p.code; actions.append(a); row.append(actions); right.append(row);
    }
    grid.append(left, right); app.append(grid);
  } catch {
    intro('Moderation', 'Dein Platz\nam Mischpult.', 'Die Moderations-PIN findest du im Terminal oder in deiner Server-Konfiguration.'); $('h1').style.whiteSpace = 'pre-line';
    const form = el('form', undefined, 'form narrow'); const label = el('label', 'Moderations-PIN'); label.htmlFor = 'pin'; const pin = el('input'); pin.id = 'pin'; pin.type = 'password'; pin.required = true; pin.autocomplete = 'current-password';
    const b = el('button', 'Los geht’s ↗'); form.append(label, pin, b); form.onsubmit = async e => { e.preventDefault(); b.disabled = true; try { await api('/api/login', { pin: pin.value }); host(); } catch (err) { toast(err.message); b.disabled = false; } }; app.append(form);
  }
}
function connection() { const s = $('#connection'); if (s) { s.replaceChildren(el('i', undefined, 'dot' + (socket.connected ? ' online' : '')), document.createTextNode(socket.connected ? 'Live verbunden' : 'Verbinde erneut …')); } }
function updatePoll(p) {
  poll = p;
  if (!$('#pollOptions')) {
    app.replaceChildren();
    const top = el('div', undefined, 'topline'); top.append(el('span', 'Live-Feedback', 'eyebrow'), el('span', code, 'code')); app.append(top);
    app.append(el('h1', p.question, 'polltitle'));
    app.append(el('div', undefined, 'options')); $('.options').id = 'pollOptions';
    const foot = el('div', undefined, 'pollfoot'); const total = el('span'); total.id = 'total'; const live = el('span', undefined, 'badge'); live.id = 'connection'; const online = el('span'); online.id = 'presence'; foot.append(total, live, online); app.append(foot);
    const note = el('p', undefined, 'muted'); note.id = 'voteNote'; app.append(note);
    const share = el('div', undefined, 'share'); const address = el('p'); address.append(el('label', 'Hier mitmachen'), el('br'), document.createTextNode(location.host + '/p/' + code));
    const copy = el('button', 'Link kopieren', 'secondary small'); copy.onclick = async () => { try { await navigator.clipboard.writeText(location.origin + '/p/' + code); toast('Link kopiert.'); } catch { toast('Link: ' + location.origin + '/p/' + code); } }; share.append(address, copy);
    if (screen) { const full = el('button', 'Vollbild', 'secondary small'); full.onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => toast('Vollbild ist hier nicht verfügbar.')); share.append(full); }
    app.append(share); connection();
    if (screen) api('/api/host/polls').then(() => {
      const toggle = el('button', '', 'secondary small'); toggle.id = 'toggle'; toggle.onclick = async () => { try { await api('/api/host/polls/' + code, { open: !poll.open }); } catch (err) { toast(err.message); } }; share.append(toggle); updateText();
    }).catch(() => {});
  }
  for (const o of p.options) {
    let button = document.getElementById('option-' + o.id);
    if (!button) {
      button = el('button', undefined, 'option'); button.id = 'option-' + o.id;
      button.append(el('span', undefined, 'fill')); const line = el('span', undefined, 'optionline'); line.append(el('span', o.label, 'optionlabel'), el('span', '0 %', 'count')); button.append(line, el('small', '', 'detail'));
      button.onclick = () => {
        if (busy || screen || !poll.open || !socket.connected) return;
        busy = true;
        socket.timeout(6000).emit('poll:vote', { code, option: o.id }, (err, reply) => {
          busy = false; if (err || !reply?.ok) return toast(reply?.error || 'Verbindung kurz unterbrochen. Bitte nochmals versuchen.');
          myVote = reply.myVote; updatePoll(poll); toast('Deine Stimme ist dabei.');
        });
      };
      $('#pollOptions').append(button);
    }
    const percent = p.total ? Math.round(o.votes / p.total * 100) : 0;
    button.querySelector('.fill').style.width = percent + '%'; button.querySelector('.count').textContent = percent + ' %';
    button.querySelector('.detail').textContent = o.votes + (o.votes === 1 ? ' Stimme' : ' Stimmen') + (myVote === o.id ? ' · Deine Wahl ✓' : '');
    button.classList.toggle('chosen', myVote === o.id && !screen); button.disabled = screen || !p.open || !socket.connected; button.setAttribute('aria-pressed', String(myVote === o.id));
  }
  updateText();
}
function updateText() {
  $('#total').replaceChildren(el('strong', poll.total + (poll.total === 1 ? ' Stimme' : ' Stimmen')));
  $('#presence').textContent = deviceCount + (deviceCount === 1 ? ' Gerät online' : ' Geräte online');
  $('#voteNote').textContent = !poll.open ? 'Abstimmung geschlossen. Danke fürs Mitmachen.' : screen ? 'Die Ergebnisse aktualisieren sich live.' : myVote ? 'Du kannst deine Wahl ändern, solange die Abstimmung offen ist.' : 'Tippe auf eine Antwort. Eine Stimme pro Browser.';
  if ($('#toggle')) $('#toggle').textContent = poll.open ? 'Abstimmung schliessen' : 'Wieder öffnen';
}
async function loadPoll() {
  try { const p = await api('/api/polls/' + code); myVote = p.myVote; updatePoll(p); if (socket.connected) join(); }
  catch (err) { intro('Nicht gefunden', 'Diese Runde fehlt noch.', err.message); }
}
function join() { socket.emit('poll:join', code, reply => { if (!reply.ok) return toast(reply.error); updatePoll(reply.poll); }); }
socket.on('connect', () => { connection(); if (code && poll) { api('/api/polls/' + code).then(p => { myVote = p.myVote; updatePoll(p); join(); }).catch(err => toast(err.message)); } });
socket.on('disconnect', () => { connection(); if (poll) updatePoll(poll); });
socket.on('poll:update', p => updatePoll(p));
socket.on('poll:presence', data => { deviceCount = data.devices; if (poll) updateText(); });
if (code) loadPoll(); else if (location.pathname === '/host') host(); else home();
