# Capital District

[Play online](https://robmarek.github.io/capital-district/)

Capital District is a property strategy game built for Synergy Network. Buy lots, collect rent, improve properties, and manage cash as city fees and market events hit. After 12 rounds, the portfolio with the highest net worth wins.

## Play locally

From this directory, start a static server and open [localhost:8763](http://localhost:8763/).

```sh
python3 -m http.server 8763 --bind 127.0.0.1 --directory dist
```

Choose **New game** and pick **Solo vs computer** to play against Morgan, or share one device with another player. The browser saves the match and mode on the current device.

Each player starts with 1,500 practice SNRG and collects 200 SNRG for reaching or passing City Hall. After rolling, a player can buy the available property they land on and upgrade one property they own. Each property can be upgraded twice. Fees and rent can reduce a player's cash below zero. **View portfolios** shows each player's holdings, rent and asset value. After rolling, sell one eligible property back to the city for 75% of its asset value rounded down. This raises cash, reduces net worth, and removes the property's upgrades.

SNRG is Synergy Network’s native coin. Browser balances and the contract prototype are practice balances. The Testnet button queries the live chain ID. [Synergy Testnet v3 network details](https://forge.synergy-network.io/networks)

## Run the checks

```sh
node --test test/*.test.mjs
```

See [chain/README.md](chain/README.md) for the SynQ contract, compiled artifacts, local AIVM tests, and the path to native SNRG settlement. The contract covers the original two-seat board rules and uses a deterministic movement schedule for local verification. The browser rolls random dice and adds the computer opponent, portfolio views, and property sales. Public deployment and settlement require verified Testnet v3 contract admission and canonical receipts. [Synergy Forge runtime status](https://forge.synergy-network.io/build/aivm/overview)

## Project layout

- `dist/` contains the browser game, artwork, and read-only Testnet connection.
- `test/` contains the browser rules and network module tests.
- `chain/` contains the SynQ implementation, compiler outputs, and local AIVM harness.

The board’s background is an original generated illustration of a midnight Art Deco financial district with navy shadows and brass-lit towers.
