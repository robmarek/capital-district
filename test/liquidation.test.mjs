import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ROUNDS, buyProperty, createGame, endTurn, getActions, getPropertyValue, getRent,
  getSaleProceeds, loadGame, netWorth, rollDice, saveGame, sellProperty, upgradeProperty,
} from '../dist/game.mjs';

function roll(state, first = 1, second = 1) {
  const dice = [first, second];
  return rollDice(state, () => (dice.shift() - 0.5) / 6);
}

function withPortfolio() {
  const state = createGame();
  state.properties = {
    2: { owner: 0, level: 0 },
    4: { owner: 1, level: 1 },
    7: { owner: 0, level: 2 },
  };
  return state;
}

test('selling after a roll returns 75% of upgraded book value rounded down', () => {
  const setup = withPortfolio();
  setup.players[0].cash = -35;
  assert.deepEqual(getActions(setup).sellIds, []);
  assert.throws(() => sellProperty(setup, 7), /after rolling/);

  const landed = roll(setup);
  assert.deepEqual(getActions(landed).sellIds, [2, 7]);
  assert.equal(getSaleProceeds(landed, 7), 296);
  assert.equal(getSaleProceeds(landed, 4), 187);
  assert.equal(getSaleProceeds(landed, 3), 0);
  assert.equal(getSaleProceeds(landed, 8), 0);
  assert.equal(getPropertyValue(landed, 7), 395);
  assert.equal(getRent(landed, 7), 114);
  assert.throws(() => sellProperty(landed, 4), /previously owned/);

  const sold = sellProperty(landed, 7);
  assert.equal(sold.players[0].cash, 261);
  assert.equal(netWorth(sold, 0), netWorth(landed, 0) - 99);
  assert.equal(sold.properties[7], undefined);
  assert.equal(getRent(sold, 7), 38);
  assert.equal(getSaleProceeds(sold, 7), 0);
  assert.deepEqual(landed.properties[7], { owner: 0, level: 2 });
  assert.deepEqual(getActions(sold).sellIds, []);
  assert.throws(() => sellProperty(sold, 2), /one previously owned/);
  assert.deepEqual(sold.activity[0], {
    type: 'sale',
    message: 'Avery sold Union Station back to the bank for 296 SNRG.',
    playerIndex: 0,
    spaceId: 7,
    amount: 296,
  });
});

test('a sold landed property cannot be repurchased until a later turn', () => {
  const sale = sellProperty(roll(withPortfolio()), 2);
  assert.equal(sale.players[0].position, 2);
  assert.equal(sale.properties[2], undefined);
  assert.equal(getActions(sale).canBuy, false);
  assert.throws(() => buyProperty(sale), /available property/);

  const reloaded = loadGame(saveGame(sale));
  assert.deepEqual(reloaded, sale);
  assert.equal(getActions(reloaded).canBuy, false);
  assert.deepEqual(getActions(reloaded).sellIds, []);
  const laterLanding = roll(endTurn(reloaded));
  assert.equal(laterLanding.players[1].position, 2);
  assert.equal(laterLanding.players[1].cash, 1500);
  assert.equal(getActions(laterLanding).canBuy, true);
  assert.deepEqual(buyProperty(laterLanding).properties[2], { owner: 1, level: 0 });
  assert.deepEqual(getActions(laterLanding).sellIds, [4]);
});

test('selling a different asset can fund a purchase without a same-turn buy-and-sell', () => {
  const setup = withPortfolio();
  setup.players[0].cash = 5;
  const landed = roll(setup, 4, 4);
  assert.equal(landed.players[0].position, 8);
  assert.equal(getActions(landed).canBuy, false);
  const sold = sellProperty(landed, 7);
  assert.equal(getActions(sold).canBuy, true);
  assert.equal(buyProperty(sold).players[0].cash, 81);

  const bought = buyProperty(roll(withPortfolio(), 4, 4));
  assert.deepEqual(getActions(bought).sellIds, [2, 7]);
  assert.throws(() => sellProperty(bought, 8), /previously owned/);
  const upgraded = upgradeProperty(bought, 8);
  const loaded = loadGame(saveGame(upgraded));
  assert.deepEqual(getActions(loaded).sellIds, [2, 7]);
  assert.throws(() => sellProperty(loaded, 8), /previously owned/);

  const nextRound = endTurn(roll(endTurn(loaded), 1, 2));
  assert.ok(getActions(roll(nextRound)).sellIds.includes(8));
});

test('old saves migrate and invalid sale state is rejected', () => {
  const prior = buyProperty(roll(withPortfolio(), 4, 4));
  const { soldThisTurn, ...legacy } = prior;
  assert.equal(soldThisTurn, null);
  for (const version of [1, 2]) {
    const loaded = loadGame(saveGame({ ...legacy, version }));
    assert.equal(loaded.soldThisTurn, null);
    assert.deepEqual(getActions(loaded).sellIds, [2, 7]);
  }

  const sold = sellProperty(roll(withPortfolio()), 2);
  for (const badSale of [
    { ...sold, soldThisTurn: null },
    { ...sold, soldThisTurn: '2' },
    { ...sold, soldThisTurn: 3 },
    { ...sold, properties: { ...sold.properties, 2: { owner: 0, level: 0 } } },
    { ...sold, activity: [{ ...sold.activity[0], playerIndex: 1 }, ...sold.activity.slice(1)] },
    { ...sold, activity: [{ ...sold.activity[0], amount: 98 }, ...sold.activity.slice(1)] },
    { ...sold, activity: [sold.activity[0], ...sold.activity] },
    { ...endTurn(sold), soldThisTurn: 2 },
  ]) {
    assert.throws(() => loadGame(saveGame(badSale)), /invalid/);
  }
});

test('a liquidation discount counts toward the final winner', () => {
  const setup = createGame();
  setup.round = ROUNDS;
  setup.currentPlayer = 1;
  setup.players[1].cash = 1300;
  setup.properties[7] = { owner: 1, level: 1 };
  const landed = roll(setup);
  assert.equal(netWorth(landed, 1), 1590);
  assert.equal(endTurn(landed).winner, 1);
  const finished = endTurn(sellProperty(landed, 7));
  assert.equal(netWorth(finished, 1), 1517);
  assert.equal(finished.winner, 1);

  setup.players[1].cash = 1250;
  const weaker = roll(setup);
  assert.equal(endTurn(weaker).winner, 1);
  const lowerResult = endTurn(sellProperty(weaker, 7));
  assert.equal(netWorth(lowerResult, 1), 1467);
  assert.equal(lowerResult.winner, 0);
  assert.deepEqual(loadGame(saveGame(lowerResult)), lowerResult);
});
