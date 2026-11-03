'use strict';
const STORAGE_KEY = 'little-airport-v1';
const COLORS = ['#ec8c76', '#e7bc5d', '#80b8cf', '#99b89c'];
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
const simulation = new AirportSimulation(state);
let selectedId = simulation.selectable[0].id;
let audioContext;
let paused = false;
let toastUntil = 0;
const nodes = new Map();
function save() {
  state = { landings: simulation.landings, score: simulation.score, sound: state.sound };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Continue without saving. */ }
}
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
AirportSimulation.INBOUND.forEach(route => svg('path', { d: routePath(route), class: 'inbound-guide' }, document.querySelector('#route-guides')));
AirportSimulation.RUNWAYS.forEach((runway, index) => {
  const dx = runway.end.x - runway.start.x, dy = runway.end.y - runway.start.y;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dx, -dy) * 180 / Math.PI;
  const group = svg('g', { transform: `translate(${runway.start.x} ${runway.start.y}) rotate(${angle})`, class: 'map-runway', role: 'button', tabindex: '0', 'aria-label': `${runway.name}滑走路へ案内` }, document.querySelector('#map-runways'));
  svg('rect', { x: -30, y: -length - 10, width: 60, height: length + 20, rx: 9, fill: '#667e77', stroke: runway.color, 'stroke-width': 7 }, group);
  svg('path', { d: `M0 -30V${-length + 30}`, stroke: '#fff8dc', 'stroke-width': 3, 'stroke-dasharray': '13 15' }, group);
  svg('path', { d: 'M-18 -12v-24m9 0v24m18 0v-24m9 0v24', stroke: '#fff8dc', 'stroke-width': 4 }, group);
  const label = svg('text', { x: -21, y: 35, fill: '#34565c', 'font-size': 27, 'font-weight': 800 }, group);
  label.textContent = runway.name;
  group.addEventListener('click', () => runways[index].click());
  group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); runways[index].click(); } });
  strips.push(group);
  runways[index].style.setProperty('--accent', runway.color);
  const final = AirportSimulation.approach(AirportSimulation.ENTRY, runway);
  svg('path', { d: routePath(final), class: 'approach-guide', stroke: runway.color }, document.querySelector('#route-guides'));
});
function render() {
  if (!simulation.selectable.some(f => f.id === selectedId)) selectedId = simulation.selectable[0]?.id ?? null;
  const selected = simulation.selectable.find(f => f.id === selectedId);
  const field = airport.getBoundingClientRect();
  for (const flight of simulation.flights) {
    let node = nodes.get(flight.id);
    if (!node) {
      node = document.createElement('button');
      node.type = 'button'; node.className = 'aircraft';
      node.innerHTML = document.querySelector('#plane-art').innerHTML + '<span class="flight-badge"></span>';
      node.style.setProperty('--plane-color', COLORS[flight.color]);
      node.addEventListener('click', () => { if (!paused) selectFlight(flight.id); });
      traffic.append(node); nodes.set(flight.id, node);
    }
    const selectable = flight.phase === 'inbound' || flight.phase === 'holding';
    const pose = simulation.pose(flight);
    // The map fills the available screen; keep aircraft aligned after scaling.
    const radians = pose.angle * Math.PI / 180;
    const screenAngle = Math.atan2(Math.sin(radians) * field.width / 1000, Math.cos(radians) * field.height / 1400) * 180 / Math.PI;
    const grounded = flight.phase === 'rollout' || flight.phase === 'taxi';
    const scale = grounded ? .65 : flight.phase === 'approach' ? 1 - Math.min(1, (simulation.time - flight.startedAt) / flight.duration) * .35 : 1;
    const statuses = { inbound: 'ひこうちゅう', holding: 'じょうくうたいき', approach: 'しんにゅう', rollout: 'ちゃくりく', taxi: 'ちじょういどう' };
    node.disabled = !selectable || paused;
    node.classList.toggle('chosen', selectable && selectedId === flight.id);
    node.classList.toggle('holding', flight.phase === 'holding');
    node.classList.toggle('grounded', grounded);
    node.classList.toggle('label-visible', flight.id === selectedId || flight.phase === 'holding');
    node.setAttribute('aria-pressed', String(selectable && selectedId === flight.id));
    node.setAttribute('aria-label', `ひこうき${flight.id}、${statuses[flight.phase]}、${AirportSimulation.RUNWAYS[flight.choice].name}滑走路へ`);
    node.querySelector('.flight-badge').textContent = `${String(flight.id).padStart(2, '0')} → ${AirportSimulation.RUNWAYS[flight.choice].name}${flight.phase === 'holding' ? ' たいき' : ''}`;
    node.querySelector('.flight-badge').style.transform = `translateX(-50%) rotate(${-screenAngle}deg)`;
    node.style.left = `${pose.x / 10}%`;
    node.style.top = `${pose.y / 14}%`;
    node.style.transform = `translate(-50%, -50%) rotate(${screenAngle}deg) scale(${scale})`;
    node.style.opacity = flight.phase === 'taxi' ? String(Math.min(1, (1 - (simulation.time - flight.startedAt) / flight.duration) * 3)) : '1';
  }
  for (const [id, node] of nodes) {
    if (!simulation.flights.some(f => f.id === id)) { node.remove(); nodes.delete(id); }
  }
  runways.forEach((button, index) => {
    const occupied = simulation.runways[index].flightId !== null;
    const recommended = !occupied && selected?.color === index;
    button.classList.toggle('occupied', occupied);
    button.classList.toggle('recommended', recommended);
    strips[index].classList.toggle('occupied', occupied);
    strips[index].classList.toggle('recommended', recommended);
    strips[index].setAttribute('aria-disabled', String(paused));
    button.disabled = paused;
    button.querySelector('.runway-status').textContent = occupied ? 'しようちゅう' : 'あいてる';
    button.setAttribute('aria-label', `${AirportSimulation.RUNWAYS[index].name}滑走路、${occupied ? '使用中' : '空いています'}${recommended ? '、おすすめ' : ''}`);
  });
  let guide = '';
  if (selected) {
    const future = AirportSimulation.approach(selected.phase === 'holding' ? simulation.pose(selected) : AirportSimulation.ENTRY, AirportSimulation.RUNWAYS[selected.choice]);
    if (selected.phase === 'inbound') guide = routePath(selected.route) + ' ';
    guide += routePath(future);
  }
  document.querySelector('#selected-route').setAttribute('d', guide);
  document.querySelector('#waiting-count').textContent = simulation.holding.length;
  document.querySelector('#score').textContent = simulation.score;
  count.textContent = simulation.landings;
  message.textContent = paused ? 'ちょっと ひとやすみ' : 'おそらの みちを たどって';
  hint.textContent = paused ? 'つづける ボタンで また あそべるよ' : selected ? `${String(selected.id).padStart(2, '0')}ばん → ${AirportSimulation.RUNWAYS[selected.choice].name}へ。おすすめ ${AirportSimulation.RUNWAYS[selected.color].name}：★20` : 'ひこうきは じどうで ちゃくりくするよ';
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
    if (event.bonus) { notify(`ナイス あんない！ ★＋${event.bonus}`); chime(); }
  }
  render();
}, 1000 / 30);
updateSound();
render();
