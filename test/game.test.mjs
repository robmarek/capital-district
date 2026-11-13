import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOARD,
  CURRENCY,
  LAP_INCOME,
  ROUNDS,
  START_CASH,
  buyProperty,
  createGame,
  endTurn,
  getActions,
  getPropertyValue,
  getRent,
  loadGame,
  netWorth,
  rollDice,
  saveGame,
  upgradeProperty,
} from '../dist/game.mjs';

function roll(state, ...dice) {
  return rollDice(state, () => (dice.shift() - 0.5) / 6);
}

test('a new game has two portfolios and a twenty-space board', () => {
  const state = createGame(['  Morgan ', '']);
  assert.equal(BOARD.length, 20);
  assert.equal(BOARD.filter((space) => space.type === 'property').length, 12);
  assert.equal(CURRENCY, 'SNRG');
  assert.match(state.activity[0].message, /1,500 practice SNRG/);
  assert.deepEqual(state.players.map((player) => player.name), ['Morgan', 'Jordan']);
  assert.deepEqual(state.players.map((_, index) => netWorth(state, index)), [START_CASH, START_CASH]);
  assert.deepEqual(getActions(state), { canRoll: true, canBuy: false, canEnd: false, upgradeIds: [], sellIds: [] });
  assert.throws(() => endTurn(state), /before ending/);
  assert.throws(() => buyProperty(state), /landed on/);
  assert.throws(() => rollDice(state, () => 1), /randomness/);
});

test('a purchase and improvement move practice SNRG into assets and increase rent', () => {
  const start = createGame();
  const landed = roll(start, 1, 1);
  assert.equal(start.players[0].position, 0);
  assert.equal(landed.players[0].position, 2);
  assert.deepEqual(landed.dice, [1, 1]);
  assert.equal(getActions(landed).canBuy, true);
  assert.throws(() => roll(landed, 1, 1), /once per turn/);

  const bought = buyProperty(landed);
  const upgraded = upgradeProperty(bought, 2);
  assert.deepEqual(landed.properties, {});
  assert.deepEqual(bought.properties[2], { owner: 0, level: 0 });
  assert.deepEqual(upgraded.properties[2], { owner: 0, level: 1 });
  assert.equal(upgraded.players[0].cash, START_CASH - BOARD[2].price - BOARD[2].upgradeCost);
  assert.equal(getPropertyValue(upgraded, 2), BOARD[2].price + BOARD[2].upgradeCost);
  assert.equal(getRent(upgraded, 2), BOARD[2].rent * 2);
  assert.match(upgraded.activity[0].message, /Rent is now 50 SNRG\./);
  assert.match(bought.activity[0].message, /for 130 SNRG\./);
  assert.equal(netWorth(upgraded, 0), START_CASH);
  assert.equal(getActions(upgraded).canBuy, false);
  assert.deepEqual(getActions(upgraded).upgradeIds, []);
  assert.throws(() => upgradeProperty(upgraded, 2), /one eligible property/);
});

test('landing on an opponent’s property transfers the full rent and debt reduces net worth', () => {
  const start = createGame();
  const owned = upgradeProperty(buyProperty(roll(start, 1, 1)), 2);
  const next = endTurn(owned);
  next.players[1].cash = 15;
  const landed = roll(next, 1, 1);
  assert.equal(landed.players[1].cash, -35);
  assert.equal(landed.players[0].cash, owned.players[0].cash + 50);
  assert.equal(netWorth(landed, 1), -35);
  assert.equal(getActions(landed).canBuy, false);
  assert.equal(landed.activity[0].type, 'rent');
  assert.equal(landed.activity[0].amount, -50);
  assert.match(landed.activity[0].message, /50 SNRG in rent/);
});

test('an investor can upgrade an owned property from another tile until it reaches level two', () => {
  let state = endTurn(upgradeProperty(buyProperty(roll(createGame(), 1, 1)), 2));
  state = endTurn(roll(state, 1, 2));
  state = roll(state, 1, 2);
  assert.equal(state.players[0].position, 5);
  assert.deepEqual(getActions(state).upgradeIds, [2]);
  state = upgradeProperty(state, 2);
  assert.equal(getRent(state, 2), BOARD[2].rent * 3);
  state = endTurn(state);
  state = endTurn(roll(state, 1, 1));
  state = roll(state, 1, 1);
  assert.deepEqual(getActions(state).upgradeIds, []);
  assert.throws(() => upgradeProperty(state, 2), /eligible property/);
});

test('reaching or crossing City Hall pays salary before tile effects', () => {
  const start = createGame();
  start.players[0].position = 18;
  const exact = roll(start, 1, 1);
  assert.equal(exact.players[0].position, 0);
  assert.equal(exact.players[0].cash, START_CASH + LAP_INCOME);

  const bonus = roll(start, 2, 3);
  assert.equal(bonus.players[0].position, 3);
  assert.equal(bonus.players[0].cash, START_CASH + LAP_INCOME + BOARD[3].amount);
  assert.deepEqual(bonus.activity.slice(0, 2).map((entry) => entry.type), ['income', 'income']);

  const taxed = roll(createGame(), 3, 6);
  assert.equal(taxed.players[0].cash, START_CASH + BOARD[9].amount);
  assert.equal(taxed.activity[0].type, 'tax');
});

test('a market event uses the current round and tile', () => {
  const roundOne = roll(createGame(), 2, 3);
  assert.equal(roundOne.players[0].cash, START_CASH + 60);
  assert.equal(roundOne.activity[0].type, 'event');
  const start = createGame();
  start.round = 2;
  const roundTwo = roll(start, 2, 3);
  assert.equal(roundTwo.players[0].cash, START_CASH - 45);
});

test('the second player closes each round and the match ends after 24 turns', () => {
  let state = createGame();
  for (let turn = 0; turn < ROUNDS * 2; turn += 1) {
    assert.equal(state.currentPlayer, turn % 2);
    assert.equal(state.round, Math.floor(turn / 2) + 1);
    state = endTurn(roll(state, 1, 1));
  }
  assert.equal(state.phase, 'finished');
  assert.equal(state.winner, null);
  assert.equal(state.activity[0].type, 'result');
  assert.deepEqual(getActions(state), { canRoll: false, canBuy: false, canEnd: false, upgradeIds: [], sellIds: [] });
  assert.deepEqual(loadGame(saveGame(state)), state);
});

test('the final score includes property value when selecting a winner', () => {
  const state = createGame();
  state.round = ROUNDS;
  state.currentPlayer = 1;
  state.players[0].cash = START_CASH - 200;
  state.properties[19] = { owner: 0, level: 0 };
  const finished = endTurn(roll(state, 1, 1));
  assert.equal(finished.winner, 0);
  assert.equal(netWorth(finished, 0), 1600);
  assert.equal(netWorth(finished, 1), 1500);
});

test('saved actions resume with the same inventory, dice, and limits', () => {
  const state = upgradeProperty(buyProperty(roll(createGame(), 1, 1)), 2);
  const loaded = loadGame(saveGame(state));
  assert.deepEqual(loaded, state);
  assert.deepEqual(getActions(loaded).upgradeIds, []);
  assert.deepEqual(endTurn(loaded), endTurn(state));
  assert.throws(() => loadGame('{'), /could not be read/);
  assert.throws(() => loadGame('null'), /invalid/);
  assert.throws(() => loadGame(saveGame({ ...state, dice: [0, 4] })), /invalid/);
  assert.throws(() => loadGame(saveGame({ ...state, properties: { 3: { owner: 0, level: 0 } } })), /invalid/);
});

test('a legacy save relabels the activity without changing progress or player names', () => {
  const state = buyProperty(roll(createGame(['Avery 100 credits', 'Jordan']), 1, 1));
  const legacy = {
    ...state,
    version: 1,
    activity: [
      { ...state.activity[0], message: 'Avery 100 credits bought Dockside Market for 130 credits.' },
      state.activity[1],
      { ...state.activity[2], message: 'Both players start with 1,500 credits. Build the highest net worth in 12 rounds.' },
    ],
  };
  assert.deepEqual(loadGame(saveGame(legacy)), state);
});
