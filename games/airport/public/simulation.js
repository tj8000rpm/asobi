/* Shared world coordinates keep map, route guides and aircraft in alignment. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const point = (x, y) => ({ x, y });
  const RUNWAYS = [
    { name: 'A', number: '16R', color: '#eb967f', start: point(235, 725), end: point(330, 1060), gate: point(350, 840) },
    { name: 'B', number: '22', color: '#e9c36a', start: point(480, 555), end: point(195, 695), gate: point(345, 720) },
    { name: 'C', number: '16L', color: '#78b7d0', start: point(485, 665), end: point(580, 1000), gate: point(425, 820) },
    { name: 'D', number: '23', color: '#9dbb91', start: point(820, 1090), end: point(570, 1210), gate: point(470, 980) }
  ];
  function path(points) {
    const distances = [0];
    for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    return { points, distances, length: distances.at(-1) };
  }
  function curve(a, b, c, d) {
    return Array.from({ length: 61 }, (_, i) => {
      const t = i / 60, u = 1 - t;
      return point(u*u*u*a.x + 3*u*u*t*b.x + 3*u*t*t*c.x + t*t*t*d.x, u*u*u*a.y + 3*u*u*t*b.y + 3*u*t*t*c.y + t*t*t*d.y);
    });
  }
  function sample(route, progress) {
    const distance = Math.max(0, Math.min(1, progress)) * route.length;
    let i = 1;
    while (i < route.distances.length - 1 && route.distances[i] < distance) i++;
    const a = route.points[i - 1], b = route.points[i];
    const position = lerp(a, b, (distance - route.distances[i - 1]) / (route.distances[i] - route.distances[i - 1] || 1));
    return { ...position, angle: Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI };
  }
  const FIX = point(760, 300);
  const INBOUND = [
    path(curve(point(280, -40), point(320, 100), point(990, 300), FIX)),
    path(curve(point(520, -40), point(540, 90), point(990, 300), FIX)),
    path(curve(point(1040, 120), point(1000, 210), point(990, 300), FIX)),
    path(curve(point(1040, 420), point(1050, 360), point(990, 300), FIX))
  ];
  function approach(position, runway) {
    const dx = runway.end.x - runway.start.x, dy = runway.end.y - runway.start.y;
    const length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
    const final = point(runway.start.x - ux * 155, runway.start.y - uy * 155);
    const radians = position.angle * Math.PI / 180;
    const turn = curve(position,
      point(position.x + Math.sin(radians) * 160, position.y - Math.cos(radians) * 160),
      point(final.x - ux * 110, final.y - uy * 110), final);
    return path([...turn, runway.start]);
  }
  class AirportSimulation {
    constructor(saved = {}) {
      const safe = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
      this.score = safe(saved.score); this.landings = safe(saved.landings);
      this.time = 0; this.nextArrival = 6; this.nextId = 1;
      this.flights = []; this.events = [];
      this.runways = RUNWAYS.map(() => ({ flightId: null }));
      this.addFlight(0, .60); this.addFlight(0, .30); this.addFlight(2, .05);
    }
    addFlight(color = [0, 2, 0, 2, 1, 3][(this.nextId - 1) % 6], progress = 0) {
      if (this.flights.length >= 12) return null;
      const route = INBOUND[(this.nextId - 1) % 4];
      const flight = { id: this.nextId++, color, choice: color, phase: 'inbound', arrivedAt: this.time,
        startedAt: this.time - progress * route.length / 65, route, duration: route.length / 65,
        runway: null, manual: false, bonus: 0, holdSince: null };
      this.flights.push(flight);
      return flight;
    }
    get selectable() { return this.flights.filter(f => f.phase === 'inbound' || f.phase === 'holding'); }
    get holding() { return this.flights.filter(f => f.phase === 'holding'); }
    pose(flight) {
      if (flight.phase === 'holding') {
        const angle = (this.time - flight.startedAt) * TAU / 17 + Math.PI / 2;
        return { x: 760 + 130 * Math.cos(angle), y: 160 + 140 * Math.sin(angle), angle: Math.atan2(-130 * Math.sin(angle), -140 * Math.cos(angle)) * 180 / Math.PI };
      }
      return sample(flight.route, (this.time - flight.startedAt) / flight.duration);
    }
    assign(id, index, manual = true) {
      const flight = this.selectable.find(f => f.id === id);
      if (!flight || !this.runways[index] || this.runways[index].flightId !== null) return false;
      flight.choice = index; flight.manual = manual;
      if (flight.phase === 'holding') this.beginApproach(flight);
      return true;
    }
    beginApproach(flight) {
      const runway = this.runways[flight.choice];
      if (runway.flightId !== null) return false;
      const route = approach(this.pose(flight), RUNWAYS[flight.choice]);
      flight.bonus = flight.manual ? (flight.color === flight.choice ? 20 : 10) + (flight.holdSince !== null ? 5 : 0) : 0;
      flight.runway = flight.choice; runway.flightId = flight.id;
      flight.route = route; flight.duration = route.length / 85;
      flight.startedAt = this.time; flight.phase = 'approach';
      return true;
    }
    tick(seconds) {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      let remaining = seconds;
      while (remaining > .000001) {
        const step = Math.min(.1, remaining); this.time += step; remaining -= step;
        for (const flight of this.flights) {
          if (flight.phase === 'inbound' && this.time - flight.startedAt >= flight.duration) {
            if (!this.beginApproach(flight)) {
              flight.phase = 'holding'; flight.holdSince = this.time; flight.startedAt = this.time;
            }
          } else if (flight.phase === 'holding') {
            // Leave the circuit at its fix, rather than turning across the loop.
            const lap = (this.time - flight.startedAt) % 17;
            if (lap < step + .00001) this.beginApproach(flight);
          } else if (flight.phase === 'approach' && this.time - flight.startedAt >= flight.duration) {
            const runway = RUNWAYS[flight.runway];
            flight.phase = 'rollout'; flight.startedAt = this.time;
            flight.route = path([runway.start, lerp(runway.start, runway.end, .74)]); flight.duration = 4;
            this.landings = Math.min(Number.MAX_SAFE_INTEGER, this.landings + 1);
            this.score = Math.min(Number.MAX_SAFE_INTEGER, this.score + flight.bonus);
            this.events.push({ type: 'landed', id: flight.id, bonus: flight.bonus });
          } else if (flight.phase === 'rollout' && this.time - flight.startedAt >= flight.duration) {
            const start = this.pose(flight), runway = RUNWAYS[flight.runway];
            this.runways[flight.runway].flightId = null;
            flight.phase = 'taxi'; flight.startedAt = this.time; flight.duration = 6;
            flight.route = path(curve(start, lerp(start, runway.end, .25), point(runway.gate.x, start.y), runway.gate));
          } else if (flight.phase === 'taxi' && this.time - flight.startedAt >= flight.duration) flight.phase = 'done';
        }
        this.flights = this.flights.filter(f => f.phase !== 'done');
        if (this.time >= this.nextArrival) { this.addFlight(); this.nextArrival = this.time + 6; }
      }
    }
    drainEvents() { return this.events.splice(0); }
  }
  AirportSimulation.ENTRY = { ...FIX, angle: -90 };
  AirportSimulation.RUNWAYS = RUNWAYS;
  AirportSimulation.INBOUND = INBOUND;
  AirportSimulation.sample = sample;
  AirportSimulation.approach = approach;
  if (typeof module !== 'undefined' && module.exports) module.exports = AirportSimulation;
  else root.AirportSimulation = AirportSimulation;
})(globalThis);
