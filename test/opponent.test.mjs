import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOARD, ROUNDS, START_CASH, buyProperty, createGame, endTurn, getActions, loadGame, rollDice, saveGame,
} from '../dist/game.mjs';
import { playOpponentTurn } from '../dist/opponent.mjs';

function fixedDice(...dice) {
  return () => {
    assert.ok(dice.length, 'unexpected dice roll');
    return (dice.shift() - 0.5) / 6;
  };
}

test('the opponent makes legal investments and hands control back after one roll', () => {
  const state = endTurn(rollDice(createGame(), fixedDice(1, 2)));
  const before = saveGame(state);
  const result = playOpponentTurn(state, fixedDice(1, 1));
  assert.equal(saveGame(state), before);
  assert.deepEqual(playOpponentTurn(state, fixedDice(1, 1)), result);
  assert.deepEqual(result.properties[2], { owner: 1, level: 1 });
  assert.equal(result.players[1].position, 2);
  assert.equal(result.players[1].cash, START_CASH - BOARD[2].price - BOARD[2].upgradeCost);
  assert.equal(result.currentPlayer, 0);
  assert.equal(result.round, 2);
  assert.equal(result.phase, 'roll');
  assert.deepEqual(loadGame(saveGame(result)), result);
});

test('the opponent resumes a saved action without rerolling', () => {
  let state = endTurn(rollDice(createGame(), fixedDice(1, 2)));
  state = loadGame(saveGame(rollDice(state, fixedDice(1, 1))));
  assert.equal(state.phase, 'action');
  const result = playOpponentTurn(state, fixedDice());
  assert.equal(result.currentPlayer, 0);
  assert.equal(result.players[1].position, 2);
  assert.equal(result.properties[2].owner, 1);
});

test('the opponent keeps enough cash available for the next turns', () => {
  let state = endTurn(rollDice(createGame(), fixedDice(1, 2)));
  state.players[1].cash = 420;
  state = rollDice(state, fixedDice(1, 1));
  assert.equal(getActions(state).canBuy, true);
  const result = playOpponentTurn(state, fixedDice());
  assert.equal(result.properties[2], undefined);
  assert.equal(result.players[1].cash, 420);
});

test('a reachable high-rent property increases the opponent’s reserve', () => {
  let state = endTurn(rollDice(createGame(), fixedDice(1, 2)));
  state.players[1].cash = 470;
  state = rollDice(state, fixedDice(1, 1));
  assert.equal(playOpponentTurn(state, fixedDice()).properties[2].owner, 1);

  state.properties[14] = { owner: 0, level: 2 };
  const result = playOpponentTurn(state, fixedDice());
  assert.equal(result.properties[2], undefined);
  assert.equal(result.players[1].cash, 470);
});

test('near the end, upgrades favor the property the human can actually land on', () => {
  let state = endTurn(rollDice(createGame(), fixedDice(1, 1)));
  state.round = ROUNDS - 3;
  state.properties[2] = { owner: 1, level: 0 };
  state.properties[8] = { owner: 1, level: 0 };
  state = rollDice(state, fixedDice(1, 2));
  const result = playOpponentTurn(state, fixedDice());
  assert.equal(result.properties[2].level, 0);
  assert.equal(result.properties[8].level, 0);
  assert.equal(result.players[1].cash, state.players[1].cash);

  state.players[0].position = 1;
  const withLikelyRent = playOpponentTurn(state, fixedDice());
  assert.equal(withLikelyRent.properties[2].level, 0);
  assert.equal(withLikelyRent.properties[8].level, 1);
});

test('the opponent leaves human turns alone and skips investments after the last human roll', () => {
  const initial = createGame();
  assert.equal(playOpponentTurn(initial, fixedDice()), initial);
  let state = endTurn(buyProperty(rollDice(initial, fixedDice(1, 1))));
  state.round = ROUNDS;
  state.properties[8] = { owner: 1, level: 0 };
  state = rollDice(state, fixedDice(2, 2));
  assert.equal(getActions(state).canBuy, true);
  const finished = playOpponentTurn(state, fixedDice());
  assert.equal(finished.phase, 'finished');
  assert.equal(finished.properties[4], undefined);
  assert.equal(finished.properties[8].level, 0);
  assert.equal(playOpponentTurn(finished, fixedDice()), finished);
});
