/* Shared world coordinates keep map, route guides and aircraft in alignment. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const LANDING_POINTS = 10;
  const WAITING = { worryAfter: 12, penaltyAfter: 30, penaltyEvery: 15, penaltyPoints: 5 };
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const point = (x, y) => ({ x, y });
  const RUNWAYS = [
    { name: 'A', number: '16R', color: '#e64e58', start: point(235, 725), end: point(330, 1060), gate: point(350, 840), label: point(170, 900) },
    { name: 'B', number: '22', color: '#e5a719', start: point(480, 555), end: point(195, 695), gate: point(345, 720), label: point(360, 500) },
    { name: 'C', number: '16L', color: '#2589db', start: point(485, 665), end: point(580, 1000), gate: point(425, 820), label: point(650, 825) },
    { name: 'D', number: '23', color: '#26996d', start: point(820, 1090), end: point(570, 1210), gate: point(470, 980), label: point(800, 1240) }
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
    if (route.segments) {
      let remaining = distance;
      for (let i = 0; i < route.segments.length; i++) {
        const segment = route.segments[i];
        if (remaining <= segment.length || i === route.segments.length - 1) return segmentPose(segment, Math.min(remaining, segment.length));
        remaining -= segment.length;
      }
    }
    let i = 1;
    while (i < route.distances.length - 1 && route.distances[i] < distance) i++;
    const a = route.points[i - 1], b = route.points[i];
    const position = lerp(a, b, (distance - route.distances[i - 1]) / (route.distances[i] - route.distances[i - 1] || 1));
    return { ...position, angle: Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI };
  }
  const positiveAngle = angle => ((angle % TAU) + TAU) % TAU;
  const flightAngle = theta => Math.atan2(Math.cos(theta), -Math.sin(theta)) * 180 / Math.PI;
  function segmentPose(segment, distance) {
    if (segment.kind === 'line') return { x: segment.start.x + Math.cos(segment.theta) * distance, y: segment.start.y + Math.sin(segment.theta) * distance, angle: flightAngle(segment.theta) };
    const angle = segment.angle + segment.sign * distance / segment.radius;
    return { x: segment.center.x + Math.cos(angle) * segment.radius, y: segment.center.y + Math.sin(angle) * segment.radius, angle: flightAngle(angle + segment.sign * Math.PI / 2) };
  }
  function turnSegment(center, from, to, sign, radius) {
    const angle = Math.atan2(from.y - center.y, from.x - center.x);
    const endAngle = Math.atan2(to.y - center.y, to.x - center.x);
    let sweep = positiveAngle(sign * (endAngle - angle));
    if (TAU - sweep < 1e-9) sweep = 0;
    return { kind: 'arc', center, radius, angle, sign, length: sweep * radius };
  }
  function flightPath(start, finish, radius) {
    const theta0 = (start.angle - 90) * Math.PI / 180;
    const theta1 = (finish.angle - 90) * Math.PI / 180;
    if (Math.hypot(finish.x - start.x, finish.y - start.y) < 1e-8 && Math.abs(Math.sin((theta1 - theta0) / 2)) < 1e-8) {
      return sampledFlightPath([{ kind: 'line', start, theta: theta0, length: 0 }]);
    }
    let best;
    // Join tangent circles with a common tangent. Every airborne turn has
    // an explicit radius; no Bezier control point can create a tight cusp.
    for (const sign0 of [-1, 1]) for (const sign1 of [-1, 1]) {
      const c0 = point(start.x - sign0 * radius * Math.sin(theta0), start.y + sign0 * radius * Math.cos(theta0));
      const c1 = point(finish.x - sign1 * radius * Math.sin(theta1), finish.y + sign1 * radius * Math.cos(theta1));
      const dx = c1.x - c0.x, dy = c1.y - c0.y;
      const separation = Math.hypot(dx, dy);
      if (separation < 1e-8) continue;
      const ratio = (sign1 - sign0) * radius / separation;
      if (Math.abs(ratio) > 1 + 1e-9) continue;
      const bearing = Math.atan2(dy, dx);
      const offset = Math.asin(Math.max(-1, Math.min(1, ratio)));
      for (const theta of [bearing - offset, bearing - Math.PI + offset]) {
        const n = point(-Math.sin(theta), Math.cos(theta));
        const p0 = point(c0.x - sign0 * radius * n.x, c0.y - sign0 * radius * n.y);
        const p1 = point(c1.x - sign1 * radius * n.x, c1.y - sign1 * radius * n.y);
        const forward = (p1.x - p0.x) * Math.cos(theta) + (p1.y - p0.y) * Math.sin(theta);
        if (forward < -1e-7) continue;
        const segments = [turnSegment(c0, start, p0, sign0, radius), { kind: 'line', start: p0, theta, length: Math.max(0, forward) }, turnSegment(c1, p1, finish, sign1, radius)].filter(segment => segment.length > 1e-7);
        const length = segments.reduce((sum, segment) => sum + segment.length, 0);
        if (!best || length < best.length) best = { segments, length };
      }
    }
    if (!best) throw new Error('Unable to join flight poses with the configured turning radius');
    return sampledFlightPath(best.segments);
  }
  function sampledFlightPath(segments) {
    const points = [];
    for (const segment of segments) {
      const steps = Math.max(1, Math.ceil(segment.length / 4));
      for (let i = points.length ? 1 : 0; i <= steps; i++) points.push(segmentPose(segment, segment.length * i / steps));
    }
    return { ...path(points), segments, length: segments.reduce((sum, segment) => sum + segment.length, 0) };
  }
  const HOLDING = { cx: 725, cy: 255, rx: 210, ry: 205, period: 23 };
  const MIN_TURN_RADIUS = Math.min(HOLDING.rx, HOLDING.ry) / 4;
  const FIX = point(HOLDING.cx, HOLDING.cy + HOLDING.ry);
  const ENTRY = { ...FIX, angle: -90 };
  const INBOUND = [
    flightPath({ x: 280, y: -40, angle: 180 }, ENTRY, MIN_TURN_RADIUS),
    flightPath({ x: 520, y: -40, angle: 180 }, ENTRY, MIN_TURN_RADIUS),
    flightPath({ x: 1040, y: 120, angle: -90 }, ENTRY, MIN_TURN_RADIUS),
    flightPath({ x: 1040, y: 420, angle: -90 }, ENTRY, MIN_TURN_RADIUS)
  ];
  function approach(position, runway) {
    const dx = runway.end.x - runway.start.x, dy = runway.end.y - runway.start.y;
    const length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
    const angle = Math.atan2(ux, -uy) * 180 / Math.PI;
    const finalDistance = runway.name === 'B' ? 100 : 155;
    const final = { x: runway.start.x - ux * finalDistance, y: runway.start.y - uy * finalDistance, angle };
    const join = flightPath(position, final, MIN_TURN_RADIUS);
    return sampledFlightPath([...join.segments, { kind: 'line', start: final, theta: Math.atan2(uy, ux), length: finalDistance }]);
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
        runway: null, manual: false, bonus: 0, holdSince: null, nextPenaltyAt: null };
      this.flights.push(flight);
      return flight;
    }
    get selectable() { return this.flights.filter(f => f.phase === 'inbound' || f.phase === 'holding'); }
    get holding() { return this.flights.filter(f => f.phase === 'holding'); }
    waitingStatus(flight) {
      const seconds = flight.phase === 'holding' && flight.holdSince !== null ? Math.max(0, this.time - flight.holdSince) : 0;
      const urgency = flight.phase !== 'holding' ? 'none' : seconds >= WAITING.penaltyAfter ? 'urgent' : seconds >= WAITING.worryAfter ? 'worried' : 'waiting';
      return { seconds, urgency };
    }
    pose(flight) {
      if (flight.phase === 'holding') {
        const angle = (this.time - flight.startedAt) * TAU / HOLDING.period + Math.PI / 2;
        return { x: HOLDING.cx + HOLDING.rx * Math.cos(angle), y: HOLDING.cy + HOLDING.ry * Math.sin(angle), angle: Math.atan2(-HOLDING.rx * Math.sin(angle), -HOLDING.ry * Math.cos(angle)) * 180 / Math.PI };
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
      if (!flight.manual) {
        const firstWaiting = this.holding.filter(other => other.choice === flight.choice).sort((a, b) => a.holdSince - b.holdSince || a.id - b.id)[0];
        if (firstWaiting && firstWaiting !== flight) return false;
      }
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
              flight.nextPenaltyAt = this.time + WAITING.penaltyAfter;
            }
          } else if (flight.phase === 'holding') {
            // Leave the circuit at its fix, rather than turning across the loop.
            const lap = (this.time - flight.startedAt) % HOLDING.period;
            if (lap < step + .00001) this.beginApproach(flight);
            if (flight.phase === 'holding' && flight.nextPenaltyAt !== null && this.time + .000001 >= flight.nextPenaltyAt) {
              const deduction = Math.min(this.score, WAITING.penaltyPoints);
              this.score -= deduction;
              flight.nextPenaltyAt += WAITING.penaltyEvery;
              if (deduction > 0) this.events.push({ type: 'delay', id: flight.id, runway: flight.choice, points: -deduction, waited: this.time - flight.holdSince });
            }
          } else if (flight.phase === 'approach' && this.time - flight.startedAt >= flight.duration) {
            const runway = RUNWAYS[flight.runway];
            flight.phase = 'rollout'; flight.startedAt = this.time;
            flight.route = path([runway.start, lerp(runway.start, runway.end, .74)]); flight.duration = 4;
            this.landings = Math.min(Number.MAX_SAFE_INTEGER, this.landings + 1);
            this.score = Math.min(Number.MAX_SAFE_INTEGER, this.score + LANDING_POINTS + flight.bonus);
            this.events.push({ type: 'landed', id: flight.id, runway: flight.runway, base: LANDING_POINTS, bonus: flight.bonus, points: LANDING_POINTS + flight.bonus });
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
  AirportSimulation.WAITING = WAITING;
  AirportSimulation.LANDING_POINTS = LANDING_POINTS;
  AirportSimulation.HOLDING = HOLDING;
  AirportSimulation.ENTRY = ENTRY;
  AirportSimulation.MIN_TURN_RADIUS = MIN_TURN_RADIUS;
  AirportSimulation.flightPath = flightPath;
  AirportSimulation.RUNWAYS = RUNWAYS;
  AirportSimulation.INBOUND = INBOUND;
  AirportSimulation.sample = sample;
  AirportSimulation.approach = approach;
  if (typeof module !== 'undefined' && module.exports) module.exports = AirportSimulation;
  else root.AirportSimulation = AirportSimulation;
})(globalThis);
