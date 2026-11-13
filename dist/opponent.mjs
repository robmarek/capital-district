import { BOARD, LAP_INCOME, ROUNDS, buyProperty, endTurn, getActions, getRent, rollDice, upgradeProperty } from './game.mjs';

const OPPONENT = 1;
const HUMAN = 0;
const FIRST_ROLL_SUM = 2;
const ROLL_WEIGHTS = [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
const ROLL_OUTCOMES = 36;
const MIN_PURCHASE_RETURN = 0.06;
const MIN_UPGRADE_RETURN = 0.075;
const MAX_CITY_FEE = Math.max(...BOARD.filter(({ type }) => type === 'tax').map(({ amount }) => -amount));

function expectedVisits(position, rolls) {
  let current = Array(BOARD.length).fill(0);
  const visits = Array(BOARD.length).fill(0);
  current[position] = 1;
  for (let roll = 0; roll < rolls; roll += 1) {
    const next = Array(BOARD.length).fill(0);
    for (const { id } of BOARD) {
      for (const [index, weight] of ROLL_WEIGHTS.entries()) {
        const destination = (id + FIRST_ROLL_SUM + index) % BOARD.length;
        const chance = current[id] * weight / ROLL_OUTCOMES;
        next[destination] += chance;
        visits[destination] += chance;
      }
    }
    current = next;
  }
  return visits;
}

function cashReserve(state) {
  const position = state.players[OPPONENT].position;
  // A lap's income stays liquid for new lots, plus the highest near-term bill.
  const bills = ROLL_WEIGHTS.map((_, index) => {
    const id = (position + FIRST_ROLL_SUM + index) % BOARD.length;
    return state.properties[id]?.owner === HUMAN ? getRent(state, id) : 0;
  });
  return LAP_INCOME + Math.max(MAX_CITY_FEE, ...bills);
}

function chooseUpgrade(state, visits, reserve) {
  const cash = state.players[OPPONENT].cash;
  let bestId = null;
  let bestValue = 0;
  for (const id of getActions(state).upgradeIds) {
    const { upgradeCost, rent } = BOARD[id];
    if (cash - upgradeCost < reserve) continue;
    const value = visits[id] * rent - upgradeCost * MIN_UPGRADE_RETURN;
    if (value > bestValue) {
      bestId = id;
      bestValue = value;
    }
  }
  return bestId;
}

export function playOpponentTurn(state, random = Math.random) {
  if (state.currentPlayer !== OPPONENT || state.phase === 'finished') return state;

  let current = state.phase === 'roll' ? rollDice(state, random) : state;
  const remainingRolls = ROUNDS - current.round;
  if (remainingRolls === 0) return endTurn(current);

  const visits = expectedVisits(current.players[HUMAN].position, remainingRolls);
  const { position, cash } = current.players[OPPONENT];
  const landed = BOARD[position];
  const reserve = cashReserve(current);
  // Book value already contributes to net worth. Evaluate investments on their
  // projected rent and keep more cash available when considering an upgrade.
  if (getActions(current).canBuy && cash - landed.price >= reserve
    && visits[position] * landed.rent > landed.price * MIN_PURCHASE_RETURN) {
    current = buyProperty(current);
  }
  const upgradeId = chooseUpgrade(current, visits, reserve + LAP_INCOME);
  if (upgradeId !== null) current = upgradeProperty(current, upgradeId);

  return endTurn(current);
}
