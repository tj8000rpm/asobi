'use strict';
const Airport = globalThis.AirportSimulation;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function until(game, condition, limit = 200) {
  for (let i = 0; i < limit * 10 && !condition(); i++) game.tick(.1);
  assert.ok(condition(), 'condition reached before timeout');
}

test('aircraft follow inbound routes and complete unattended landings', () => {
  const game = new Airport();
  const flight = game.flights[0];
  assert.equal(flight.phase, 'inbound');
  const before = game.pose(flight);
  game.tick(1);
  assert.ok(distance(before, game.pose(flight)) > 50);
  until(game, () => flight.phase === 'approach');
  until(game, () => flight.phase === 'rollout');
  assert.ok(distance(game.pose(flight), Airport.RUNWAYS[0].start) < 2);
  assert.equal(game.score, game.landings * Airport.LANDING_POINTS);
  assert.ok(game.landings >= 1);
});

test('aircraft align with their runway before touchdown', () => {
  for (let index = 0; index < 4; index++) {
    const runway = Airport.RUNWAYS[index];
    const route = Airport.approach(Airport.ENTRY, runway);
    const pose = Airport.sample(route, .99);
    const angle = Math.atan2(runway.end.x - runway.start.x, -(runway.end.y - runway.start.y)) * 180 / Math.PI;
    assert.ok(Math.abs(pose.angle - angle) < .0001);
    if (index === 0 || index === 2) {
      assert.ok(pose.y < runway.start.y, 'A/C approach from the north');
      assert.ok(runway.end.y > runway.start.y, 'A/C roll south after landing');
    }
    assert.ok(distance(Airport.sample(route, 1), runway.start) < .001);
  }
});

test('changing destination en route does not teleport or begin landing early', () => {
  const game = new Airport();
  const flight = game.flights[0];
  const before = game.pose(flight);
  assert.equal(game.assign(flight.id, 2), true);
  assert.equal(flight.phase, 'inbound');
  assert.ok(distance(before, game.pose(flight)) < .001);
  until(game, () => flight.phase === 'rollout');
  assert.equal(flight.runway, 2);
  assert.equal(game.score, 10 + game.landings * Airport.LANDING_POINTS);
});

test('busy runway produces a continuous holding loop and eventually clears', () => {
  const game = new Airport();
  game.flights = [];
  const first = game.addFlight(0, 1);
  const second = game.addFlight(0, 1);
  game.tick(.1);
  assert.equal(first.phase, 'approach');
  assert.equal(second.phase, 'holding');
  const start = game.pose(second);
  game.tick(2);
  assert.ok(distance(start, game.pose(second)) > 50);
  assert.equal(game.assign(second.id, 0), false);
  until(game, () => second.phase === 'approach');
  assert.equal(second.runway, 0);
});

test('manual diversion from holding joins a curved approach with no teleport and gives bonus', () => {
  const game = new Airport();
  game.flights = [];
  game.addFlight(0, 1);
  const waiting = game.addFlight(0, 1);
  game.tick(.1); game.tick(2);
  const before = game.pose(waiting);
  assert.equal(game.assign(waiting.id, 2), true);
  assert.equal(waiting.phase, 'approach');
  assert.ok(distance(before, game.pose(waiting)) < .001);
  assert.equal(waiting.bonus, 15);
  until(game, () => waiting.phase === 'rollout');
  assert.equal(game.score, 15 + game.landings * Airport.LANDING_POINTS);
});

test('runway reservation includes rollout and releases before taxi', () => {
  const game = new Airport();
  const flight = game.flights[0];
  until(game, () => flight.phase === 'rollout');
  assert.equal(game.runways[0].flightId, flight.id);
  game.tick(2);
  assert.equal(game.runways[0].flightId, flight.id);
  until(game, () => flight.phase === 'taxi');
  assert.notEqual(game.runways[0].flightId, flight.id);
  until(game, () => !game.flights.includes(flight));
});

test('15 minutes unattended stays bounded and never reserves a runway twice', () => {
  const game = new Airport();
  const initial = game.flights.map(f => f.id);
  const landed = new Set();
  for (let i = 0; i < 900; i++) {
    game.tick(1);
    game.drainEvents().filter(event => event.type === 'landed').forEach(event => landed.add(event.id));
    assert.ok(game.flights.length <= 12);
    const active = game.flights.filter(f => f.phase === 'approach' || f.phase === 'rollout');
    assert.equal(new Set(active.map(f => f.runway)).size, active.length);
    active.forEach(f => assert.equal(game.runways[f.runway].flightId, f.id));
    game.flights.forEach(f => {
      const pose = game.pose(f);
      assert.ok(Number.isFinite(pose.x) && Number.isFinite(pose.y) && Number.isFinite(pose.angle));
    });
  }
  initial.forEach(id => assert.ok(landed.has(id)));
  assert.ok(game.landings > 50);
});

test('stored totals, matching-route bonus and invalid input handling', () => {
  const game = new Airport({ landings: 12, score: 50 });
  const flight = game.flights[0];
  assert.equal(game.assign(999, 0), false);
  assert.equal(game.assign(flight.id, 9), false);
  assert.equal(game.assign(flight.id, 0), true);
  game.tick(NaN); game.tick(Infinity); game.tick(-1);
  assert.equal(game.time, 0);
  until(game, () => flight.phase === 'rollout');
  assert.equal(game.score, 70 + (game.landings - 12) * Airport.LANDING_POINTS);
  const arrivals = game.drainEvents();
  assert.ok(arrivals.some(event => event.id === flight.id && event.bonus === 20));
  assert.equal(game.landings, 12 + arrivals.length);
  assert.equal(game.assign(flight.id, 1), false);
  assert.equal(new Airport({ landings: -1, score: '50' }).score, 0);
  assert.equal(new Airport({ landings: 12 }).landings, 12);
});


test('expanded holding area stays on map and rejoins the entry fix continuously', () => {
  const game = new Airport();
  const area = Airport.HOLDING;
  assert.ok(area.rx * area.ry > 2 * 130 * 140);
  assert.ok(area.cx - area.rx > 0 && area.cx + area.rx < 1000);
  assert.ok(area.cy - area.ry > 0 && area.cy + area.ry < 555);
  game.flights = [];
  game.addFlight(0, 1);
  const waiting = game.addFlight(0, 1);
  game.tick(.1);
  assert.equal(waiting.phase, 'holding');
  assert.ok(distance(game.pose(waiting), Airport.ENTRY) < .001);
  const start = game.time;
  for (let i = 0; i <= 24; i++) {
    game.time = start + area.period * i / 24;
    const pose = game.pose(waiting);
    assert.ok(pose.x >= area.cx - area.rx - .001 && pose.x <= area.cx + area.rx + .001);
    assert.ok(pose.y >= area.cy - area.ry - .001 && pose.y <= area.cy + area.ry + .001);
  }
  assert.ok(distance(game.pose(waiting), Airport.ENTRY) < .001);
});


test('every automatic touchdown awards base points exactly once, with delays accounted separately', () => {
  const game = new Airport();
  game.tick(120);
  const events = game.drainEvents();
  const landings = events.filter(event => event.type === 'landed');
  assert.ok(landings.length > 0);
  assert.equal(landings.length, game.landings);
  assert.equal(game.score, events.reduce((sum, event) => sum + event.points, 0));
  landings.forEach(event => {
    assert.equal(event.base, 10);
    assert.equal(event.bonus, 0);
    assert.equal(event.points, 10);
    assert.ok(event.runway >= 0 && event.runway < 4);
  });
  assert.equal(new Set(landings.map(event => event.id)).size, landings.length);
  assert.equal(game.drainEvents().length, 0);
});

test('nice guidance adds a separate bonus on top of landing points', () => {
  for (const destination of [0, 2]) {
    const game = new Airport();
    const flight = game.flights[0];
    game.assign(flight.id, destination);
    until(game, () => flight.phase === 'rollout');
    const events = game.drainEvents();
    const reward = events.find(event => event.id === flight.id);
    assert.equal(reward.base, 10);
    assert.equal(reward.bonus, destination === 0 ? 20 : 10);
    assert.equal(reward.points, reward.base + reward.bonus);
    assert.equal(game.score, events.reduce((sum, event) => sum + event.points, 0));
  }
});

test('runway letter badges sit outside all runway strips', () => {
  function distanceToStrip(p, runway) {
    const dx = runway.end.x - runway.start.x, dy = runway.end.y - runway.start.y;
    const t = Math.max(0, Math.min(1, ((p.x - runway.start.x) * dx + (p.y - runway.start.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p.x - runway.start.x - t * dx, p.y - runway.start.y - t * dy);
  }
  Airport.RUNWAYS.forEach(runway => {
    Airport.RUNWAYS.forEach(other => assert.ok(distanceToStrip(runway.label, other) > 75, `${runway.name} badge overlaps ${other.name}`));
  });
});


test('B approach joins the runway without overshooting or turning back', () => {
  const route = Airport.approach(Airport.ENTRY, Airport.RUNWAYS[1]);
  let previous = Airport.sample(route, 0);
  for (let i = 1; i <= 200; i++) {
    const pose = Airport.sample(route, i / 200);
    assert.ok(pose.x <= previous.x + .001, 'B approach must not turn back east');
    assert.ok(pose.y >= previous.y - .001, 'B approach must not turn back north');
    const delta = ((pose.angle - previous.angle + 540) % 360) - 180;
    assert.ok(Math.abs(delta) < 15, `unexpected heading change: ${delta}`);
    previous = pose;
  }
});

function angleDifference(a, b) { return ((a - b + 540) % 360 + 360) % 360 - 180; }
function checkAirborneRoute(route) {
  assert.ok(route.segments.length > 0);
  for (const segment of route.segments) {
    if (segment.kind === 'arc') assert.ok(segment.radius >= Airport.MIN_TURN_RADIUS - .000001);
  }
  let previous = Airport.sample(route, 0);
  const steps = Math.max(1, Math.ceil(route.length / 2));
  const stepLength = route.length / steps;
  for (let i = 1; i <= steps; i++) {
    const pose = Airport.sample(route, i / steps);
    assert.ok(distance(previous, pose) <= stepLength + .001, 'position jump at segment boundary');
    assert.ok(Math.abs(angleDifference(pose.angle, previous.angle)) <= stepLength / Airport.MIN_TURN_RADIUS * 180 / Math.PI + .001, 'turning tighter than the minimum radius');
    previous = pose;
  }
}

test('arrival paths and every runway approach respect the shared minimum turning radius', () => {
  assert.equal(Airport.MIN_TURN_RADIUS, Math.min(Airport.HOLDING.rx, Airport.HOLDING.ry) / 4);
  Airport.INBOUND.forEach(checkAirborneRoute);
  Airport.RUNWAYS.forEach(runway => {
    const route = Airport.approach(Airport.ENTRY, runway);
    checkAirborneRoute(route);
    assert.ok(distance(Airport.sample(route, 0), Airport.ENTRY) < .00001);
    assert.ok(distance(Airport.sample(route, 1), runway.start) < .00001);
    assert.ok(Math.abs(angleDifference(Airport.sample(route, 0).angle, Airport.ENTRY.angle)) < .00001);
  });
});

test('diversions from every side of the holding circle retain position, heading and turn radius', () => {
  const { game, flight } = blockedAirport();
  const start = game.time;
  for (let step = 0; step < 16; step++) {
    game.time = start + Airport.HOLDING.period * step / 16;
    const pose = game.pose(flight);
    Airport.RUNWAYS.forEach(runway => {
      const route = Airport.approach(pose, runway);
      checkAirborneRoute(route);
      const first = Airport.sample(route, 0);
      assert.ok(distance(first, pose) < .00001);
      assert.ok(Math.abs(angleDifference(first.angle, pose.angle)) < .00001);
      assert.ok(distance(Airport.sample(route, 1), runway.start) < .00001);
    });
  }
});

test('a zero-distance pose retains its position and heading', () => {
  const pose = { x: 400, y: 300, angle: 72 };
  const route = Airport.flightPath(pose, pose, Airport.MIN_TURN_RADIUS);
  assert.equal(route.length, 0);
  const result = Airport.sample(route, .5);
  assert.ok(distance(result, pose) < .00001);
  assert.ok(Math.abs(angleDifference(result.angle, pose.angle)) < .00001);
});

function blockedAirport(score = 100) {
  const game = new Airport({ score });
  game.flights = [];
  game.nextArrival = Infinity;
  const flight = game.addFlight(0, 1);
  game.runways[0].flightId = -1;
  game.tick(.1);
  return { game, flight };
}

test('holding aircraft get increasingly worried and penalties repeat at defined intervals', () => {
  const { game, flight } = blockedAirport();
  assert.equal(game.waitingStatus(flight).urgency, 'waiting');
  game.tick(Airport.WAITING.worryAfter + .1);
  assert.equal(game.waitingStatus(flight).urgency, 'worried');
  assert.equal(game.score, 100);
  game.tick(Airport.WAITING.penaltyAfter - Airport.WAITING.worryAfter);
  assert.equal(game.waitingStatus(flight).urgency, 'urgent');
  assert.equal(game.score, 95);
  const events = game.drainEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'delay');
  assert.equal(events[0].points, -5);
  game.tick(Airport.WAITING.penaltyEvery);
  assert.equal(game.score, 90);
  assert.equal(game.drainEvents().length, 1);
});

test('penalties never make the score negative and stop once a plane is guided out', () => {
  const { game, flight } = blockedAirport(3);
  game.tick(Airport.WAITING.penaltyAfter + .1);
  assert.equal(game.score, 0);
  assert.equal(game.drainEvents()[0].points, -3);
  game.tick(Airport.WAITING.penaltyEvery);
  assert.equal(game.score, 0);
  assert.equal(game.drainEvents().length, 0);
  assert.ok(game.assign(flight.id, 2));
  assert.equal(game.waitingStatus(flight).urgency, 'none');
  game.tick(60);
  const events = game.drainEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'landed');
  assert.equal(game.score, events[0].points);
});
