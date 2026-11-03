'use strict';
const STORAGE_KEY = 'little-airport-v1';
const runways = [...document.querySelectorAll('.runway')];
const airport = document.querySelector('.airport');
const traffic = document.querySelector('#traffic');
const message = document.querySelector('#message');
const hint = document.querySelector('#hint');
const count = document.querySelector('#count');
const soundButton = document.querySelector('#sound');
const soundLabel = document.querySelector('#sound-label');
const arrival = document.querySelector('#arrival');
let state = { landings: 0, score: 0, sound: false };
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (saved && typeof saved === 'object') state = { ...state, ...saved, sound: saved.sound === true };
} catch { /* Storage is optional. */ }
let scoreboard = Array.isArray(state.scoreboard) ? state.scoreboard.filter(entry =>
  entry && Number.isSafeInteger(entry.score) && entry.score >= 0 &&
  Number.isSafeInteger(entry.landings) && entry.landings >= 0 && typeof entry.date === 'string'
).sort((a, b) => b.score - a.score || b.landings - a.landings).slice(0, 10) : [];
let simulation = new AirportSimulation(state);
function renderScoreboard() {
  const list = document.querySelector('#scoreboard');
  list.replaceChildren();
  for (const entry of scoreboard) {
    const row = document.createElement('li');
    row.textContent = `${entry.score}点 ・ ${entry.landings}機 ・ ${entry.date}`;
    list.append(row);
  }
  if (!scoreboard.length) {
    const row = document.createElement('li');
    row.textContent = 'まだ きろくは ないよ';
    list.append(row);
  }
}
let selectedId = simulation.selectable[0].id;
let audioContext;
let paused = false;
let toastUntil = 0;
const nodes = new Map();
const pointPopups = [];
let scorePulseUntil = 0;
let scorePulseNice = false;
let scorePulsePenalty = false;
function save() {
  state = { landings: simulation.landings, score: simulation.score, sound: state.sound, scoreboard };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Continue without saving. */ }
}
document.querySelector('#clear-scoreboard').addEventListener('click', () => {
  if (!window.confirm('スコアボードの記録をすべて削除しますか？')) return;
  scoreboard = [];
  save();
  renderScoreboard();
  document.querySelector('#scoreboard-message').textContent = '記録をクリアしました';
});
function updateSound() {
  soundButton.setAttribute('aria-pressed', String(state.sound));
  soundButton.setAttribute('aria-label', state.sound ? '音をオフにする' : '音をオンにする');
  soundLabel.textContent = state.sound ? 'ON' : 'OFF';
}

function unlockAudio() {
  if (!state.sound) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    audioContext ||= new Audio();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  } catch { /* Audio is optional. */ }
}

function chime(notes = [523.25, 659.25, 783.99]) {
  if (!state.sound || !audioContext || audioContext.state !== 'running') return;
  notes.forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const start = audioContext.currentTime + index * 0.16;
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.075, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.46);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  });
}

soundButton.addEventListener('click', () => {
  state.sound = !state.sound;
  updateSound();
  save();
  unlockAudio();
  chime([659.25]);
});


function selectFlight(id) {
  selectedId = id;
  unlockAudio();
  chime([523.25]);
  render();
}
function notify(text) {
  arrival.textContent = text;
  arrival.classList.add('visible');
  toastUntil = simulation.time + 2;
}
document.querySelector('#reset-score').addEventListener('click', () => {
  if (!window.confirm('今回の記録をスコアボードに残して、スコア・着陸回数・飛行機の位置を最初に戻しますか？')) return;
  if (simulation.landings > 0 || simulation.score > 0) {
    scoreboard.push({ score: simulation.score, landings: simulation.landings, date: new Date().toLocaleString('ja-JP') });
    scoreboard.sort((a, b) => b.score - a.score || b.landings - a.landings);
    scoreboard = scoreboard.slice(0, 10);
  }
  simulation = new AirportSimulation();
  selectedId = simulation.selectable[0].id;
  for (const node of nodes.values()) node.remove();
  nodes.clear();
  paused = false;
  pauseButton.textContent = 'Ⅱ';
  pauseButton.setAttribute('aria-label', '一時停止する');
  pauseButton.setAttribute('aria-pressed', 'false');
  airport.classList.remove('paused');
  previous = performance.now();
  renderScoreboard();
  scorePulseUntil = 0;
  scorePulseNice = false;
  scorePulsePenalty = false;
  for (const popup of pointPopups) popup.node.remove();
  pointPopups.length = 0;
  save();
  message.textContent = '記録を残して、最初から始めました';
  notify('さいしょから はじめるよ');
  render();
});
runways.forEach((button, index) => button.addEventListener('click', () => {
  if (paused) return;
  unlockAudio();
  if (!selectedId) { notify('ひこうきを えらんでね'); return; }
  if (!simulation.assign(selectedId, index)) {
    notify('ここは つかっているよ。ほかは どうかな？');
  } else {
    chime([523.25]);
    selectedId = simulation.selectable[0]?.id ?? null;
  }
  render();
}));
const pauseButton = document.querySelector('#pause');
pauseButton.addEventListener('click', () => {
  paused = !paused;
  pauseButton.textContent = paused ? '▶' : 'Ⅱ';
  pauseButton.setAttribute('aria-label', paused ? '再開する' : '一時停止する');
  pauseButton.setAttribute('aria-pressed', String(paused));
  airport.classList.toggle('paused', paused);
  render();
});
const NS = 'http://www.w3.org/2000/svg';
const routePath = route => route.points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
const strips = [];
function svg(tag, attributes, parent) {
  const node = document.createElementNS(NS, tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  parent.append(node);
  return node;
}
const holdingArea = AirportSimulation.HOLDING;
Object.entries({ cx: holdingArea.cx, cy: holdingArea.cy, rx: holdingArea.rx, ry: holdingArea.ry }).forEach(([key, value]) => document.querySelector('#holding-area').setAttribute(key, value));
document.querySelector('#holding-label').setAttribute('transform', `translate(${holdingArea.cx} ${holdingArea.cy})`);
document.querySelector('.holding-symbol').setAttribute('y', -8);
document.querySelector('.holding-caption').setAttribute('y', 32);
AirportSimulation.INBOUND.forEach(route => svg('path', { d: routePath(route), class: 'inbound-guide' }, document.querySelector('#route-guides')));
AirportSimulation.RUNWAYS.forEach((runway, index) => {
  const dx = runway.end.x - runway.start.x, dy = runway.end.y - runway.start.y;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dx, -dy) * 180 / Math.PI;
  const group = svg('g', { transform: `translate(${runway.start.x} ${runway.start.y}) rotate(${angle})`, class: 'map-runway', role: 'button', tabindex: '0', 'aria-label': `${runway.name}滑走路へ案内` }, document.querySelector('#map-runways'));
  svg('rect', { x: -30, y: -length - 10, width: 60, height: length + 20, rx: 9, fill: runway.color, stroke: '#fff9e8', 'stroke-width': 7 }, group);
  svg('path', { d: `M0 -30V${-length + 30}`, stroke: '#fff8dc', 'stroke-width': 3, 'stroke-dasharray': '13 15' }, group);
  svg('path', { d: 'M-18 -12v-24m9 0v24m18 0v-24m9 0v24', stroke: '#fff8dc', 'stroke-width': 4 }, group);
  const badge = svg('g', { transform: `rotate(${-angle}) translate(${runway.label.x - runway.start.x} ${runway.label.y - runway.start.y})`, class: 'runway-map-badge' }, group);
  svg('path', { d: `M${(runway.start.x + runway.end.x) / 2 - runway.label.x} ${(runway.start.y + runway.end.y) / 2 - runway.label.y}L0 0`, fill: 'none', stroke: runway.color, 'stroke-width': 4, 'stroke-linecap': 'round' }, badge);
  svg('circle', { r: 32, fill: runway.color, stroke: '#fffdf1', 'stroke-width': 5 }, badge);
  const label = svg('text', { x: 0, y: 10, fill: index === 1 ? '#604500' : '#fff', 'font-size': 30, 'font-weight': 900, 'text-anchor': 'middle' }, badge);
  label.textContent = runway.name;
  group.addEventListener('click', () => runways[index].click());
  group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); runways[index].click(); } });
  strips.push(group);
  runways[index].style.setProperty('--accent', runway.color);
  runways[index].style.setProperty('--accent-ink', index === 1 ? '#604500' : '#fff');
  const final = AirportSimulation.approach(AirportSimulation.ENTRY, runway);
  svg('path', { d: routePath(final), class: 'approach-guide', stroke: runway.color }, document.querySelector('#route-guides'));
});
function showPoints({ title, points, details, position, color, nice = false, penalty = false }) {
  const popup = document.createElement('div');
  popup.className = `points-popup${nice ? ' nice' : ''}${penalty ? ' penalty' : ''}`;
  const caption = document.createElement('span');
  caption.className = 'points-title';
  caption.textContent = title;
  const amount = document.createElement('strong');
  amount.textContent = `★ ${points >= 0 ? '+' : '−'}${Math.abs(points)}`;
  popup.append(caption, amount);
  if (details) {
    const breakdown = document.createElement('small');
    breakdown.textContent = details;
    popup.append(breakdown);
  }
  popup.style.setProperty('--runway-color', color);
  const field = airport.getBoundingClientRect();
  const width = nice || penalty ? 150 : 112;
  const height = nice || penalty ? 92 : 65;
  const x = Math.max(width / 2 + 4, Math.min(field.width - width / 2 - 4, position.x / 1000 * field.width));
  let y = Math.max(height + 8, position.y / 1400 * field.height - 30);
  for (const existing of pointPopups) {
    if (Math.abs(x - existing.x) < (width + existing.width) / 2 + 5 && Math.abs(y - existing.y) < 95) y = Math.max(height + 8, existing.y - 100);
  }
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;
  document.querySelector('#landing-points').append(popup);
  pointPopups.push({ node: popup, until: simulation.time + 2.8, x, y, width });
  scorePulseNice = nice || (!penalty && simulation.time < scorePulseUntil && scorePulseNice);
  scorePulsePenalty = penalty;
  scorePulseUntil = simulation.time + .8;
}
function showLanding(event) {
  const runway = AirportSimulation.RUNWAYS[event.runway];
  const nice = event.bonus > 0;
  showPoints({
    title: nice ? '✦ ナイス あんない！ ✦' : `${runway.name} とうちゃく！`,
    points: event.points,
    details: nice ? `ちゃくりく +${event.base} ・ ナイス +${event.bonus}` : '',
    position: runway.start, color: runway.color, nice
  });
  message.textContent = nice ? `ナイスあんない。着陸${event.base}点、ボーナス${event.bonus}点、合計${event.points}点` : `${runway.name}滑走路に到着、${event.points}点`;
  if (nice) chime(); else chime([659.25]);
}
function showDelay(event) {
  const flight = simulation.flights.find(f => f.id === event.id);
  const runway = AirportSimulation.RUNWAYS[event.runway];
  showPoints({ title: `${runway.name}まち・まちすぎだよ…`, points: event.points, details: 'あいてる かっそうろへ！', position: flight ? simulation.pose(flight) : runway.start, color: '#db6b56', penalty: true });
  message.textContent = `${runway.name}滑走路への待機が長いため${-event.points}点減点。空いている滑走路に案内できます。`;
}
function render() {
  if (!simulation.selectable.some(f => f.id === selectedId)) selectedId = simulation.selectable[0]?.id ?? null;
  const selected = simulation.selectable.find(f => f.id === selectedId);
  const field = airport.getBoundingClientRect();
  for (const flight of simulation.flights) {
    let node = nodes.get(flight.id);
    if (!node) {
      node = document.createElement('button');
      node.type = 'button'; node.className = 'aircraft';
      node.innerHTML = '<span class="plane-shape">' + document.querySelector('#plane-art').innerHTML + '</span><span class="flight-sweat" aria-hidden="true">💦</span><span class="flight-bubble"><strong class="bubble-destination"></strong><span class="bubble-state"></span><small class="bubble-wait"></small></span>';
      node.addEventListener('click', () => { if (!paused) selectFlight(flight.id); });
      traffic.append(node); nodes.set(flight.id, node);
    }
    const selectable = flight.phase === 'inbound' || flight.phase === 'holding';
    const pose = simulation.pose(flight);
    // The map fills the available screen; keep aircraft aligned after scaling.
    const radians = pose.angle * Math.PI / 180;
    const screenAngle = Math.atan2(Math.sin(radians) * field.width / 1000, Math.cos(radians) * field.height / 1400) * 180 / Math.PI;
    const waiting = simulation.waitingStatus(flight);
    node.dataset.urgency = waiting.urgency;
    const grounded = flight.phase === 'rollout' || flight.phase === 'taxi';
    const scale = grounded ? .65 : flight.phase === 'approach' ? 1 - Math.min(1, (simulation.time - flight.startedAt) / flight.duration) * .35 : 1;
    const statuses = { inbound: 'ひこうちゅう', holding: 'じょうくうたいき', approach: 'しんにゅう', rollout: 'ちゃくりく', taxi: 'ちじょういどう' };
    node.disabled = !selectable || paused;
    node.classList.toggle('chosen', selectable && selectedId === flight.id);
    node.classList.toggle('holding', flight.phase === 'holding');
    node.classList.toggle('grounded', grounded);
    node.dataset.phase = flight.phase;
    node.style.setProperty('--plane-color', AirportSimulation.RUNWAYS[flight.choice].color);
    node.style.setProperty('--bubble-ink', flight.choice === 1 ? '#906100' : AirportSimulation.RUNWAYS[flight.choice].color);
    node.setAttribute('aria-pressed', String(selectable && selectedId === flight.id));
    const destination = AirportSimulation.RUNWAYS[flight.choice].name;
    const bubbleStates = { inbound: 'いくよ！', holding: 'ぐるぐる たいき', approach: 'ちゃくりく！', rollout: 'とうちゃく', taxi: 'ちじょういどう' };
    node.setAttribute('aria-label', `${destination}滑走路へ、${statuses[flight.phase]}`);
    node.querySelector('.bubble-destination').textContent = flight.phase === 'holding' ? `${destination}まち` : `${destination}へ`;
    const waitingText = waiting.urgency === 'urgent' ? 'はやく おりたい！' : waiting.urgency === 'worried' ? 'まだかな…' : 'まってるよ…';
    node.querySelector('.bubble-state').textContent = flight.phase === 'holding' ? waitingText : bubbleStates[flight.phase];
    node.querySelector('.bubble-wait').textContent = flight.phase === 'holding' ? `⟳ ${Math.floor(waiting.seconds)}びょう たいき` : '';
    node.style.left = `${pose.x / 10}%`;
    node.style.top = `${pose.y / 14}%`;
    node.style.transform = 'translate(-50%, -50%)';
    // Unwrap headings across ±180° so rotation never takes the long way around.
    const previousHeading = Number(node.dataset.heading ?? screenAngle);
    const heading = previousHeading + ((screenAngle - previousHeading + 540) % 360 + 360) % 360 - 180;
    node.dataset.heading = heading;
    node.querySelector('.plane-shape').style.transform = `rotate(${heading}deg) scale(${scale})`;
    // Bubbles stay upright and point to the aircraft, even during a turn.
    const bubble = node.querySelector('.flight-bubble');
    const x = pose.x / 1000 * field.width;
    const halfBubble = Math.min(48, field.width / 2);
    const shift = Math.max(halfBubble + 4 - x, Math.min(0, field.width - halfBubble - 4 - x));
    node.style.setProperty('--bubble-shift', `${shift}px`);
    bubble.classList.toggle('below', pose.y / 1400 * field.height < 84);
    node.style.opacity = flight.phase === 'taxi' ? String(Math.min(1, (1 - (simulation.time - flight.startedAt) / flight.duration) * 3)) : '1';
  }
  for (const [id, node] of nodes) {
    if (!simulation.flights.some(f => f.id === id)) { node.remove(); nodes.delete(id); }
  }
  runways.forEach((button, index) => {
    const occupied = simulation.runways[index].flightId !== null;
    const recommended = !occupied && selected?.choice === index;
    const bonus = !occupied && selected?.color === index;
    button.classList.toggle('occupied', occupied);
    button.classList.toggle('recommended', recommended);
    button.classList.toggle('bonus', bonus);
    strips[index].classList.toggle('occupied', occupied);
    strips[index].classList.toggle('recommended', recommended);
    strips[index].setAttribute('aria-disabled', String(paused));
    button.disabled = paused;
    button.querySelector('.runway-status').textContent = occupied ? 'しようちゅう' : 'あいてる';
    strips[index].setAttribute('aria-label', `${AirportSimulation.RUNWAYS[index].name}滑走路、${occupied ? '使用中' : '空いています'}`);
    button.setAttribute('aria-label', `${AirportSimulation.RUNWAYS[index].name}滑走路、${occupied ? '使用中' : '空いています'}${recommended ? '、選択中の飛行機の行き先' : ''}${bonus ? '、おすすめ' : ''}`);
  });
  let guide = '';
  if (selected) {
    const future = AirportSimulation.approach(selected.phase === 'holding' ? simulation.pose(selected) : AirportSimulation.ENTRY, AirportSimulation.RUNWAYS[selected.choice]);
    if (selected.phase === 'inbound') guide = routePath(selected.route) + ' ';
    guide += routePath(future);
  }
  document.querySelector('#selected-route').setAttribute('d', guide);
  if (selected) document.querySelector('#selected-route').style.stroke = AirportSimulation.RUNWAYS[selected.choice].color;
  document.querySelector('#waiting-count').textContent = simulation.holding.length;
  document.querySelector('#score').textContent = simulation.score;
  count.textContent = simulation.landings;
  document.querySelector('.stat.score').classList.toggle('score-pop', simulation.time < scorePulseUntil);
  document.querySelector('.stat.score').classList.toggle('nice-pop', simulation.time < scorePulseUntil && scorePulseNice);
  document.querySelector('.stat.score').classList.toggle('penalty-pop', simulation.time < scorePulseUntil && scorePulsePenalty);
  for (let i = pointPopups.length - 1; i >= 0; i--) {
    if (simulation.time >= pointPopups[i].until) { pointPopups[i].node.remove(); pointPopups.splice(i, 1); }
  }
  hint.textContent = paused ? 'つづける ボタンで また あそべるよ' : selected ? `${AirportSimulation.RUNWAYS[selected.choice].name}へ あんない。おすすめ ${AirportSimulation.RUNWAYS[selected.color].name}：★20` : 'ひこうきは じどうで ちゃくりくするよ';
  if (simulation.time >= toastUntil) arrival.classList.remove('visible');
}
let previous = performance.now();
setInterval(() => {
  const now = performance.now();
  const elapsed = Math.min((now - previous) / 1000, .25);
  previous = now;
  if (paused || document.hidden) return;
  simulation.tick(elapsed);
  for (const event of simulation.drainEvents()) {
    save();
    if (event.type === 'landed') showLanding(event);
    else if (event.type === 'delay') showDelay(event);
  }
  render();
}, 1000 / 30);
updateSound();
renderScoreboard();
render();
