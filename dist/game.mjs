export const ROUNDS = 12;
export const START_CASH = 1500;
export const LAP_INCOME = 200;
export const MAX_UPGRADES = 2;
export const CURRENCY = 'SNRG';

const SAVE_VERSION = 2;
const LEGACY_SAVE_VERSION = 1;
const ACTIVITY_LIMIT = 36;
const DEFAULT_NAMES = ['Avery', 'Jordan'];

const spaces = [
  { name: 'City Hall', type: 'start', amount: LAP_INCOME },
  { name: 'Ferry Terminal', district: 'harbor', price: 100, rent: 20, upgradeCost: 55 },
  { name: 'Dockside Market', district: 'harbor', price: 130, rent: 25, upgradeCost: 70 },
  { name: 'Capital Grant', type: 'bonus', amount: 100 },
  { name: 'Harbor Lofts', district: 'harbor', price: 160, rent: 32, upgradeCost: 90 },
  { name: 'Market Pulse', type: 'market' },
  { name: 'Corner Shops', district: 'midtown', price: 150, rent: 30, upgradeCost: 85 },
  { name: 'Union Station', district: 'midtown', price: 185, rent: 38, upgradeCost: 105 },
  { name: 'Meridian Plaza', district: 'midtown', price: 220, rent: 45, upgradeCost: 120 },
  { name: 'Civic Levy', type: 'tax', amount: -80 },
  { name: 'Exchange Square', type: 'market' },
  { name: 'Studio Row', district: 'innovation', price: 175, rent: 35, upgradeCost: 100 },
  { name: 'Foundry Labs', district: 'innovation', price: 215, rent: 43, upgradeCost: 120 },
  { name: 'Research Rebate', type: 'bonus', amount: 125 },
  { name: 'Catalyst Campus', district: 'innovation', price: 255, rent: 53, upgradeCost: 140 },
  { name: 'Infrastructure Fee', type: 'tax', amount: -95 },
  { name: 'Terrace Homes', district: 'heights', price: 210, rent: 42, upgradeCost: 115 },
  { name: 'Skyline Hotel', district: 'heights', price: 260, rent: 55, upgradeCost: 145 },
  { name: 'Market Outlook', type: 'market' },
  { name: 'Summit Tower', district: 'heights', price: 300, rent: 65, upgradeCost: 165 },
];

export const BOARD = Object.freeze(spaces.map((space, id) =>
  Object.freeze({ id, type: 'property', ...space }),
));

const marketEvents = [
  { name: 'Dividend distribution', amount: 100 },
  { name: 'Unexpected maintenance', amount: -75 },
  { name: 'Local demand surge', amount: 60 },
  { name: 'Permit costs', amount: -45 },
];

const activityTypes = new Set([
  'system', 'move', 'income', 'rent', 'purchase', 'upgrade', 'sale', 'event', 'tax', 'turn', 'result',
]);

function record(state, type, message, details = {}) {
  state.activity.unshift({ type, message, ...details });
  state.activity.length = Math.min(state.activity.length, ACTIVITY_LIMIT);
}

function copyState(state) {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    properties: { ...state.properties },
    dice: state.dice && [...state.dice],
    activity: [...state.activity],
  };
}

function amountLabel(amount) {
  return `${amount.toLocaleString('en-US')} ${CURRENCY}`;
}

export function createGame(names = DEFAULT_NAMES) {
  const players = DEFAULT_NAMES.map((defaultName, index) => ({
    name: (typeof names?.[index] === 'string' && names[index].trim().slice(0, 24)) || defaultName,
    cash: START_CASH,
    position: 0,
  }));
  const state = {
    version: SAVE_VERSION,
    round: 1,
    currentPlayer: 0,
    phase: 'roll',
    players,
    properties: {},
    dice: null,
    upgradedThisTurn: false,
    soldThisTurn: null,
    activity: [],
    winner: null,
  };
  record(state, 'system', `Both players start with ${START_CASH.toLocaleString('en-US')} practice ${CURRENCY}. Build the highest net worth in ${ROUNDS} rounds.`);
  return state;
}

export function getRent(state, spaceId) {
  const space = BOARD[spaceId];
  return space?.type === 'property' ? space.rent * (1 + (state.properties[spaceId]?.level ?? 0)) : 0;
}

export function getPropertyValue(state, spaceId) {
  const space = BOARD[spaceId];
  return space?.type === 'property' ? space.price + space.upgradeCost * (state.properties[spaceId]?.level ?? 0) : 0;
}

function saleProceeds(assetValue) {
  return Math.floor(assetValue * 3 / 4);
}

export function getSaleProceeds(state, spaceId) {
  return state.properties[spaceId] ? saleProceeds(getPropertyValue(state, spaceId)) : 0;
}

export function netWorth(state, playerIndex) {
  return BOARD.reduce((total, space) => {
    const property = state.properties[space.id];
    return property?.owner === playerIndex ? total + getPropertyValue(state, space.id) : total;
  }, state.players[playerIndex].cash);
}

export function getActions(state) {
  const player = state.players[state.currentPlayer];
  const landed = BOARD[player.position];
  const canEnd = state.phase === 'action';
  const canBuy = canEnd && landed.type === 'property' && !state.properties[landed.id]
    && state.soldThisTurn !== landed.id && player.cash >= landed.price;
  const upgradeIds = canEnd && !state.upgradedThisTurn
    ? BOARD.filter((space) => {
      const property = state.properties[space.id];
      return property?.owner === state.currentPlayer && property.level < MAX_UPGRADES && player.cash >= space.upgradeCost;
    }).map((space) => space.id)
    : [];
  // Activity already records the purchase between this roll and the next turn.
  const latestPurchaseOrRoll = state.activity.find(({ type }) => type === 'purchase' || type === 'move');
  const purchasedThisTurn = latestPurchaseOrRoll?.type === 'purchase'
    && latestPurchaseOrRoll.playerIndex === state.currentPlayer && latestPurchaseOrRoll.spaceId === landed.id;
  const sellIds = canEnd && (state.soldThisTurn ?? null) === null
    ? BOARD.filter(({ id }) => state.properties[id]?.owner === state.currentPlayer && (!purchasedThisTurn || id !== landed.id)).map(({ id }) => id)
    : [];
  return { canRoll: state.phase === 'roll', canBuy, canEnd, upgradeIds, sellIds };
}

function readDie(random) {
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new Error('Dice randomness must be a number from 0 up to 1.');
  }
  return 1 + Math.floor(sample * 6);
}

function resolveLanding(state, playerIndex, space) {
  const player = state.players[playerIndex];
  const property = state.properties[space.id];
  const details = { playerIndex, spaceId: space.id };
  if (property && property.owner !== playerIndex) {
    const rent = getRent(state, space.id);
    const owner = state.players[property.owner];
    player.cash -= rent;
    owner.cash += rent;
    record(state, 'rent', `${player.name} paid ${owner.name} ${amountLabel(rent)} in rent at ${space.name}.`, { ...details, amount: -rent });
  }
  if (space.type === 'bonus' || space.type === 'tax' || space.type === 'market') {
    const event = space.type === 'market' ? marketEvents[(state.round + space.id) % marketEvents.length] : space;
    const effect = event.amount > 0 ? 'received' : 'paid';
    const type = space.type === 'bonus' ? 'income' : space.type === 'market' ? 'event' : 'tax';
    player.cash += event.amount;
    record(state, type, `${event.name} · ${player.name} ${effect} ${amountLabel(Math.abs(event.amount))}.`, { ...details, amount: event.amount });
  }
}

export function rollDice(state, random = Math.random) {
  if (state.phase !== 'roll') throw new Error('You can roll once per turn.');
  const next = copyState(state);
  const playerIndex = next.currentPlayer;
  const player = next.players[playerIndex];
  const first = readDie(random);
  const second = readDie(random);
  const distance = first + second;
  const destination = player.position + distance;
  player.position = destination % BOARD.length;
  const space = BOARD[player.position];

  next.phase = 'action';
  next.dice = [first, second];
  record(next, 'move', `${player.name} rolled ${first} + ${second} and landed on ${space.name}.`, { playerIndex, spaceId: space.id });
  if (destination >= BOARD.length) {
    player.cash += LAP_INCOME;
    record(next, 'income', `${player.name} collected ${amountLabel(LAP_INCOME)} for reaching City Hall.`, { playerIndex, spaceId: 0, amount: LAP_INCOME });
  }
  resolveLanding(next, playerIndex, space);
  return next;
}

export function buyProperty(state) {
  if (!getActions(state).canBuy) throw new Error('You can buy an available property you landed on if you can cover the price.');
  const next = copyState(state);
  const playerIndex = next.currentPlayer;
  const player = next.players[playerIndex];
  const space = BOARD[player.position];
  player.cash -= space.price;
  next.properties[space.id] = { owner: playerIndex, level: 0 };
  record(next, 'purchase', `${player.name} bought ${space.name} for ${amountLabel(space.price)}.`, { playerIndex, spaceId: space.id, amount: -space.price });
  return next;
}

export function upgradeProperty(state, spaceId) {
  if (!getActions(state).upgradeIds.includes(spaceId)) throw new Error('You can upgrade one eligible property per turn after rolling.');
  const next = copyState(state);
  const playerIndex = next.currentPlayer;
  const player = next.players[playerIndex];
  const space = BOARD[spaceId];
  const level = state.properties[spaceId].level + 1;
  player.cash -= space.upgradeCost;
  next.properties[spaceId] = { owner: playerIndex, level };
  next.upgradedThisTurn = true;
  record(next, 'upgrade', `${player.name} upgraded ${space.name} to level ${level}. Rent is now ${amountLabel(getRent(next, spaceId))}.`, { playerIndex, spaceId, amount: -space.upgradeCost });
  return next;
}

export function sellProperty(state, spaceId) {
  if (!getActions(state).sellIds.includes(spaceId)) {
    throw new Error('You can sell one previously owned property per turn after rolling.');
  }
  const next = copyState(state);
  const playerIndex = next.currentPlayer;
  const player = next.players[playerIndex];
  const proceeds = getSaleProceeds(next, spaceId);
  player.cash += proceeds;
  delete next.properties[spaceId];
  next.soldThisTurn = spaceId;
  record(next, 'sale', `${player.name} sold ${BOARD[spaceId].name} back to the bank for ${amountLabel(proceeds)}.`, {
    playerIndex, spaceId, amount: proceeds,
  });
  return next;
}

function resolveWinner(state) {
  const difference = netWorth(state, 0) - netWorth(state, 1);
  if (difference === 0) return null;
  return difference > 0 ? 0 : 1;
}

export function endTurn(state) {
  if (state.phase !== 'action') throw new Error('Roll the dice before ending the turn.');
  const next = copyState(state);
  next.upgradedThisTurn = false;
  next.soldThisTurn = null;
  next.dice = null;
  if (next.currentPlayer === 1 && next.round === ROUNDS) {
    next.phase = 'finished';
    next.winner = resolveWinner(next);
    const worth = amountLabel(netWorth(next, next.winner ?? 0));
    const message = next.winner === null
      ? `Both players tied with a net worth of ${worth}.`
      : `${next.players[next.winner].name} won with a net worth of ${worth}.`;
    record(next, 'result', message);
    return next;
  }

  next.phase = 'roll';
  next.currentPlayer = 1 - next.currentPlayer;
  if (next.currentPlayer === 0) next.round += 1;
  record(next, 'turn', `Round ${next.round} · ${next.players[next.currentPlayer].name}'s turn.`, { playerIndex: next.currentPlayer });
  return next;
}

function isIntegerBetween(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validPlayer(player) {
  return isRecord(player) && typeof player.name === 'string' && player.name.trim().length > 0 && player.name.length <= 24
    && isIntegerBetween(player.cash, -1_000_000, 1_000_000) && isIntegerBetween(player.position, 0, BOARD.length - 1);
}

function validProperty([spaceId, property]) {
  return BOARD[spaceId]?.type === 'property' && isRecord(property) && isIntegerBetween(property.owner, 0, 1)
    && isIntegerBetween(property.level, 0, MAX_UPGRADES);
}

function validActivity(entry) {
  if (!isRecord(entry) || !activityTypes.has(entry.type) || typeof entry.message !== 'string' || entry.message.length > 256
    || (entry.amount !== undefined && !Number.isSafeInteger(entry.amount))
    || (entry.playerIndex !== undefined && !isIntegerBetween(entry.playerIndex, 0, 1))
    || (entry.spaceId !== undefined && !isIntegerBetween(entry.spaceId, 0, BOARD.length - 1))) return false;
  if (entry.type !== 'sale') return true;
  const space = BOARD[entry.spaceId];
  return space?.type === 'property' && isIntegerBetween(entry.playerIndex, 0, 1)
    && Array.from({ length: MAX_UPGRADES + 1 }, (_, level) => saleProceeds(space.price + level * space.upgradeCost)).includes(entry.amount);
}

function validTurnSale(state) {
  const sold = state.soldThisTurn;
  if (state.phase !== 'action') return sold === null;
  const rollIndex = state.activity.findIndex(({ type }) => type === 'move');
  const sales = state.activity.slice(0, rollIndex < 0 ? state.activity.length : rollIndex).filter(({ type }) => type === 'sale');
  if (sold === null) return sales.length === 0;
  return isIntegerBetween(sold, 0, BOARD.length - 1) && !state.properties[sold] && sales.length === 1
    && sales[0].spaceId === sold && sales[0].playerIndex === state.currentPlayer;
}

function validTurn(state) {
  if (state.phase === 'action') {
    return state.winner === null && typeof state.upgradedThisTurn === 'boolean'
      && Array.isArray(state.dice) && state.dice.length === 2 && state.dice.every((die) => isIntegerBetween(die, 1, 6));
  }
  if (state.dice !== null || state.upgradedThisTurn !== false) return false;
  if (state.phase === 'roll') return state.winner === null;
  return state.phase === 'finished' && state.round === ROUNDS && state.currentPlayer === 1 && state.winner === resolveWinner(state);
}

export function saveGame(state) {
  return JSON.stringify(state);
}

function migrateActivity(entry) {
  if (entry.type === 'move' || entry.type === 'turn') return entry;
  const legacyUnit = ' credits';
  // The amount comes after any player name in each currency-bearing activity.
  const unitStart = entry.message.lastIndexOf(legacyUnit);
  if (unitStart === -1) return entry;
  const unit = entry.type === 'system' ? ` practice ${CURRENCY}` : ` ${CURRENCY}`;
  const message = entry.message.slice(0, unitStart) + unit + entry.message.slice(unitStart + legacyUnit.length);
  return { ...entry, message };
}

export function loadGame(json) {
  let state;
  try {
    state = JSON.parse(json);
  } catch {
    throw new Error('This saved game could not be read.');
  }
  if (isRecord(state) && !Object.hasOwn(state, 'soldThisTurn')) state.soldThisTurn = null;
  if (!isRecord(state) || ![SAVE_VERSION, LEGACY_SAVE_VERSION].includes(state.version) || !isIntegerBetween(state.round, 1, ROUNDS)
    || !isIntegerBetween(state.currentPlayer, 0, 1) || !Array.isArray(state.players) || state.players.length !== 2
    || !state.players.every(validPlayer) || !isRecord(state.properties) || !Object.entries(state.properties).every(validProperty)
    || !Array.isArray(state.activity) || state.activity.length > ACTIVITY_LIMIT || !state.activity.every(validActivity)
    || !validTurn(state) || !validTurnSale(state)) {
    throw new Error('This saved game is invalid or uses an unsupported format.');
  }
  if (state.version === LEGACY_SAVE_VERSION) {
    state.version = SAVE_VERSION;
    state.activity = state.activity.map(migrateActivity);
  }
  return state;
}
