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
  assert.equal(game.score, 0);
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
  assert.equal(game.score, 10);
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
  assert.equal(game.score, 15);
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
    game.drainEvents().forEach(event => landed.add(event.id));
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
  assert.equal(game.score, 70);
  const arrivals = game.drainEvents();
  assert.ok(arrivals.some(event => event.id === flight.id && event.bonus === 20));
  assert.equal(game.landings, 12 + arrivals.length);
  assert.equal(game.assign(flight.id, 1), false);
  assert.equal(new Airport({ landings: -1, score: '50' }).score, 0);
  assert.equal(new Airport({ landings: 12 }).landings, 12);
});
