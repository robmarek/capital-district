import {
  BOARD, CURRENCY, LAP_INCOME, MAX_UPGRADES, ROUNDS, buyProperty, createGame, endTurn, getActions,
  getPropertyValue, getRent, getSaleProceeds, loadGame, netWorth, rollDice, saveGame, sellProperty, upgradeProperty,
} from './game.mjs';
import { checkSynergyNetwork, SYNERGY_NETWORK } from './synergy.mjs';
import { playOpponentTurn } from './opponent.mjs';

const storageKey = 'capital-district.match.v1';
const opponentName = 'Morgan';
const number = new Intl.NumberFormat('en-US');
const formatSnrg = (amount) => `${number.format(amount)} ${CURRENCY}`;
const signedSnrg = (amount) => `${amount > 0 ? '+' : '−'}${formatSnrg(Math.abs(amount))}`;
const byId = (id) => document.getElementById(id);
const districtNames = {
  harbor: 'Harbor', midtown: 'Midtown', innovation: 'Innovation', heights: 'Heights',
};
const special = {
  start: { icon: '⚑', detail: `Collect ${formatSnrg(LAP_INCOME)} whenever you reach or pass City Hall.` },
  market: { icon: '⇄', detail: 'A market event can add or subtract SNRG when you land here.' },
  tax: { icon: '−', detail: 'Pay this fee when you land here.' },
  bonus: { icon: '+', detail: 'Collect this grant when you land here.' },
};
const pipPositions = [[], [5], [1, 9], [1, 5, 9], [1, 3, 7, 9], [1, 3, 5, 7, 9], [1, 3, 4, 6, 7, 9]];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function restoreMatch() {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const payload = JSON.parse(stored);
      if (payload?.mode === 'solo' || payload?.mode === 'local') {
        return { state: loadGame(JSON.stringify(payload.match)), mode: payload.mode };
      }
      return { state: loadGame(stored), mode: 'local' };
    }
  } catch {
    // The game remains playable when storage is unavailable or the save is invalid.
  }
  return { state: createGame(), mode: 'local' };
}

let { state, mode } = restoreMatch();
let selected = state.players[state.currentPlayer].position;
let preferredUpgrade = null;
let feedback = '';
let saleSpace = null;

function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ mode, match: JSON.parse(saveGame(state)) }));
  } catch {
    // Play continues in memory on browsers that restrict storage.
  }
}

function boardCoordinates(index) {
  if (index < 5) return [6, index + 1];
  if (index < 10) return [11 - index, 6];
  if (index < 15) return [1, 16 - index];
  return [index - 14, 1];
}

function tileSubtitle(space) {
  if (space.type === 'property') return formatSnrg(space.price);
  if (space.type === 'start') return 'START';
  if (space.type === 'market') return 'MARKET';
  return signedSnrg(space.amount);
}

function playerToken(index) {
  const token = element('span', `token p${index}`, index + 1);
  token.setAttribute('aria-hidden', 'true');
  return token;
}

function createTile(space) {
  const property = space.type === 'property';
  const tile = element('button', `tile ${property ? space.district : `special ${space.type}`}`);
  tile.type = 'button';
  const [row, column] = boardCoordinates(space.id);
  tile.style.gridArea = `${row} / ${column}`;
  const short = space.name === 'Infrastructure Fee' ? 'Infra. Fee' : null;
  tile.append(element('span', short ? 'tile-label tile-full has-short' : 'tile-label', space.name));
  if (short) tile.append(element('span', 'tile-label tile-short', short));
  tile.append(element('span', 'tile-value', tileSubtitle(space)));
  if (!property) {
    const icon = element('span', 'tile-icon', special[space.type].icon);
    icon.setAttribute('aria-hidden', 'true');
    tile.append(icon);
  }
  const markers = element('span', 'markers');
  markers.setAttribute('aria-hidden', 'true');
  tile.append(markers);
  tile.addEventListener('click', () => {
    selected = space.id;
    renderBoard();
    renderDetails();
  });
  byId('board').append(tile);
  return { tile, markers };
}

const tiles = BOARD.map(createTile);

function renderBoard() {
  BOARD.forEach((space) => {
    const { tile, markers } = tiles[space.id];
    const owner = state.properties[space.id];
    const present = state.players.flatMap((player, index) => player.position === space.id ? [index] : []);
    const labels = [space.name, tileSubtitle(space)];
    if (space.type === 'property') labels.push(`${districtNames[space.district]} district`);
    const badges = [];
    if (owner) {
      labels.push(`Owned by ${state.players[owner.owner].name}`);
      badges.push(element('span', `owner-mark p${owner.owner}`));
    }
    if (present.length) {
      const tokens = element('span', 'tokens');
      tokens.append(...present.map(playerToken));
      badges.push(tokens);
      labels.push(`Players here: ${present.map((index) => state.players[index].name).join(', ')}`);
    }
    tile.classList.toggle('selected', selected === space.id);
    tile.setAttribute('aria-pressed', String(selected === space.id));
    tile.setAttribute('aria-label', labels.join('. '));
    markers.replaceChildren(...badges);
  });
}

function renderDetails() {
  const space = BOARD[selected];
  const property = state.properties[selected];
  const description = element('div');
  const subtitle = space.type === 'property'
    ? `${districtNames[space.district]} district · ${property ? `Owned by ${state.players[property.owner].name} · Level ${property.level} of ${MAX_UPGRADES}` : 'Available'}`
    : special[space.type].detail;
  description.append(element('h2', '', space.name), element('p', '', subtitle));
  const figures = element('dl', 'detail-values');
  if (space.type === 'property') {
    const pairs = [[property ? 'Asset value' : 'Price', getPropertyValue(state, selected)], ['Rent', getRent(state, selected)]];
    if (property?.level !== MAX_UPGRADES) pairs.push(['Upgrade cost', space.upgradeCost]);
    if (property) pairs.push(['Sale value', getSaleProceeds(state, selected)]);
    for (const [label, value] of pairs) {
      const item = element('div');
      item.append(element('dt', '', label), element('dd', '', formatSnrg(value)));
      figures.append(item);
    }
  }
  byId('space-details').replaceChildren(description, figures);
}

function renderDice() {
  const visibleDice = state.dice ?? [1, 1];
  const dice = byId('dice');
  dice.setAttribute('aria-label', state.dice ? `Dice show ${visibleDice.join(' and ')}` : 'Dice ready');
  dice.replaceChildren(...visibleDice.map((value) => {
    const die = element('span', `die${state.dice ? ' lit' : ''}`);
    die.setAttribute('aria-hidden', 'true');
    for (const position of pipPositions[value]) {
      const pip = element('span', 'pip');
      pip.style.gridArea = `${Math.ceil(position / 3)} / ${(position - 1) % 3 + 1}`;
      die.append(pip);
    }
    return die;
  }));
}

function doAction(action, preferredFocus, summarize) {
  const restoreFocus = byId('turn-actions').contains(document.activeElement);
  try {
    const previous = state;
    state = action(state);
    selected = state.players[state.currentPlayer].position;
    feedback = summarize ? summarize(previous, state) : state.activity[0]?.message ?? '';
    persist();
  } catch (error) {
    feedback = error.message;
  }
  render();
  if (restoreFocus) {
    const next = byId(preferredFocus) ?? byId('end-turn') ?? byId('turn-actions').querySelector('button');
    next?.focus({ preventScroll: true });
  }
}

function endPlayerTurn(current) {
  const next = endTurn(current);
  return mode === 'solo' ? playOpponentTurn(next) : next;
}

function turnSummary(previous, next) {
  if (next.phase === 'finished' || mode === 'local') return next.activity[0]?.message ?? '';
  const movement = next.activity.find((entry) => entry.type === 'move' && entry.playerIndex === 1);
  const change = next.players[1].cash - previous.players[1].cash;
  return movement ? `${movement.message} Cash change ${change === 0 ? formatSnrg(0) : signedSnrg(change)}.` : '';
}

function actionButton(id, label, style, handler) {
  const button = element('button', `action-button ${style}`, label);
  button.type = 'button';
  button.id = id;
  button.addEventListener('click', handler);
  return button;
}

function renderTurn() {
  const player = state.players[state.currentPlayer];
  const space = BOARD[player.position];
  const finished = state.phase === 'finished';
  const winner = finished && state.winner !== null ? state.players[state.winner] : null;
  const count = String(state.round).padStart(2, '0');
  byId('round-label').textContent = finished ? 'MATCH COMPLETE' : `ROUND ${count} / ${ROUNDS}`;
  byId('turn-heading').textContent = finished ? (winner ? `${winner.name} wins!` : 'It’s a tie') : `${player.name}’s turn`;
  const message = finished
    ? `Final net worth is ${formatSnrg(netWorth(state, state.winner ?? 0))}.`
    : state.phase === 'roll' ? 'Roll the dice to move around the city.' : `${player.name} landed on ${space.name}.`;
  byId('turn-message').textContent = feedback || message;
  renderDice();

  const actions = getActions(state);
  const buttons = [];
  if (actions.canRoll) {
    buttons.push(actionButton('roll-dice', '⚄  Roll dice', 'primary', () => doAction(rollDice, 'buy-property', (_previous, next) => {
      const playerIndex = next.currentPlayer;
      const player = next.players[playerIndex];
      const landing = `${player.name} rolled ${next.dice.join(' + ')} and landed on ${BOARD[player.position].name}.`;
      const effect = next.activity[0];
      return effect.type === 'move' ? landing : `${landing} ${effect.message}`;
    })));
  }
  if (actions.canBuy) {
    buttons.push(actionButton('buy-property', `Buy ${space.name} · ${formatSnrg(space.price)}`, 'primary', () => doAction(buyProperty, 'end-turn')));
  }
  if (actions.upgradeIds.length) {
    if (!actions.upgradeIds.includes(preferredUpgrade)) preferredUpgrade = actions.upgradeIds[0];
    const picker = element('select', 'upgrade-picker');
    picker.setAttribute('aria-label', 'Choose a property to upgrade');
    for (const id of actions.upgradeIds) {
      const property = BOARD[id];
      const option = element('option', '', `${property.name} · ${formatSnrg(property.upgradeCost)}`);
      option.value = id;
      picker.append(option);
    }
    picker.value = preferredUpgrade;
    picker.addEventListener('change', () => { preferredUpgrade = Number(picker.value); });
    buttons.push(picker, actionButton('upgrade-property', 'Upgrade property', 'secondary', () => doAction(
      (current) => upgradeProperty(current, preferredUpgrade), 'end-turn',
    )));
  }
  if (actions.canEnd) {
    if (actions.sellIds.length) {
      buttons.push(actionButton('sell-property', 'Sell a property', 'secondary', showPortfolio));
    }
    buttons.push(actionButton('end-turn', 'End turn →', actions.canBuy ? '' : 'primary', () => doAction(endPlayerTurn, 'roll-dice', turnSummary)));
  }
  if (finished) {
    buttons.push(actionButton('play-again', 'Play again', 'primary', openNewGame));
  }
  byId('turn-actions').replaceChildren(...buttons);

  const progress = Array.from({ length: ROUNDS }, (_, index) => element('span', index < state.round ? 'reached' : ''));
  byId('round-progress').replaceChildren(...progress);
}

function renderSidebar() {
  const rows = state.players.map((player, index) => {
    const count = Object.values(state.properties).filter((property) => property.owner === index).length;
    const row = element('div', 'player-row');
    const info = element('div', 'player-info');
    const name = element('strong', '', player.name);
    if (state.currentPlayer === index && state.phase !== 'finished') {
      const active = element('span', 'player-active', '◆');
      active.setAttribute('aria-label', 'Current player');
      name.append(active);
    }
    const prefix = mode === 'solo' && index === 1 ? 'Computer · ' : '';
    info.append(name, element('small', '', `${prefix}${formatSnrg(player.cash)} cash · ${count} ${count === 1 ? 'property' : 'properties'}`));
    row.append(playerToken(index), info, element('span', 'player-worth', formatSnrg(netWorth(state, index))));
    return row;
  });
  byId('players').replaceChildren(...rows);
  byId('activity').replaceChildren(...state.activity.map((entry) => element('li', '', entry.message)));
}

function render() {
  byId('mode-label').textContent = mode === 'solo' ? 'SOLO VS COMPUTER' : '2 PLAYERS';
  renderBoard();
  renderDetails();
  renderTurn();
  renderSidebar();
}

function quoteSale(id) {
  const proceeds = getSaleProceeds(state, id);
  const loss = getPropertyValue(state, id) - proceeds;
  saleSpace = id;
  byId('sale-title').textContent = `Sell ${BOARD[id].name}?`;
  byId('sale-quote').textContent = `You receive ${formatSnrg(proceeds)} in cash and give up ${formatSnrg(loss)} in net worth. The city takes back the property and clears its upgrades.`;
  byId('sale-dialog').showModal();
}

function renderPortfolio() {
  const sales = getActions(state).sellIds;
  byId('portfolio-instructions').textContent = sales.length ? 'You can sell one property this turn.' : 'Select a property on the board to inspect it.';
  const groups = state.players.map((player, playerIndex) => {
    const group = element('section', 'portfolio-player');
    group.append(element('h3', '', player.name));
    const owned = BOARD.filter(({ id }) => state.properties[id]?.owner === playerIndex);
    if (!owned.length) group.append(element('p', '', 'No properties owned.'));
    for (const property of owned) {
      const row = element('div', 'portfolio-row');
      const description = element('div');
      description.append(
        element('strong', '', property.name),
        element('small', '', `Level ${state.properties[property.id].level} · ${formatSnrg(getRent(state, property.id))} rent · ${formatSnrg(getPropertyValue(state, property.id))} value`),
      );
      row.append(description);
      if (sales.includes(property.id)) {
        const sell = actionButton(`quote-sale-${property.id}`, `Sell · ${formatSnrg(getSaleProceeds(state, property.id))}`, 'secondary', () => quoteSale(property.id));
        sell.setAttribute('aria-label', `Sell ${property.name} for ${formatSnrg(getSaleProceeds(state, property.id))}`);
        row.append(sell);
      }
      group.append(row);
    }
    return group;
  });
  byId('portfolio-list').replaceChildren(...groups);
}

function showPortfolio() {
  renderPortfolio();
  byId('portfolio-dialog').showModal();
}

byId('confirm-sale').addEventListener('click', () => {
  const id = saleSpace;
  byId('sale-dialog').close();
  byId('portfolio-dialog').close();
  doAction((current) => sellProperty(current, id), 'end-turn');
  byId('end-turn')?.focus({ preventScroll: true });
});

const modes = [...document.querySelectorAll('[name="mode"]')];
function syncModeFields() {
  const solo = modes.find((option) => option.checked).value === 'solo';
  byId('player-two-label').hidden = solo;
  byId('player-two').disabled = solo;
}

function openNewGame() {
  modes.find((option) => option.value === mode).checked = true;
  byId('player-one').value = state.players[0].name;
  byId('player-two').value = mode === 'local' ? state.players[1].name : 'Jordan';
  syncModeFields();
  byId('new-dialog').showModal();
}

modes.forEach((option) => option.addEventListener('change', syncModeFields));
byId('show-rules').addEventListener('click', () => byId('rules-dialog').showModal());
byId('show-network').addEventListener('click', () => byId('network-dialog').showModal());
byId('new-game').addEventListener('click', openNewGame);
byId('show-portfolio').addEventListener('click', showPortfolio);

document.querySelectorAll('[data-close]').forEach((button) => {
  button.addEventListener('click', () => button.closest('dialog').close());
});

byId('new-dialog').addEventListener('close', () => {
  if (!document.activeElement.closest('button')) byId('roll-dice')?.focus({ preventScroll: true });
});

byId('new-game-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  mode = form.get('mode') === 'solo' ? 'solo' : 'local';
  state = createGame([form.get('one'), mode === 'solo' ? opponentName : form.get('two')]);
  selected = 0;
  preferredUpgrade = null;
  feedback = '';
  persist();
  render();
  byId('new-dialog').close();
  byId('roll-dice').focus({ preventScroll: true });
});

byId('check-network').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const status = byId('network-status');
  button.disabled = true;
  status.textContent = `Checking ${SYNERGY_NETWORK.name}…`;
  const result = await checkSynergyNetwork();
  status.textContent = result.message;
  document.querySelector('.network-dot').classList.toggle('verified', result.status === 'verified');
  button.disabled = false;
});

if (mode === 'solo' && state.phase !== 'finished' && state.currentPlayer === 1) {
  state = playOpponentTurn(state);
  selected = state.players[state.currentPlayer].position;
  persist();
}
render();
