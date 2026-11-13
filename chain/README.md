# Capital District on SynQ

The two-seat contract mirrors the browser game's 20-space property economy, 12-round limit, and net-worth scoring. It uses whole practice SNRG. The ledger records nonredeemable game balances and rejects attached native value. The browser rolls two random dice. The contract uses a public 24-roll sequence for reproducible local execution that visits every board space.

## Build and verify locally

Use Node.js, Rust 1.93.0, and adjacent checkouts of these Synergy repositories.

| Repository | Tested commit |
| --- | --- |
| `synq-language` | `01125b6470c6b49c586b7a28fe054a62e1c913c6` |
| `synergy-aivm` | `1533d76ec84165c567f5d36e6bdd7e283e1a96a1` |

From this directory:

```sh
node local-aivm.mjs build /path/to/synergy-checkouts
node local-aivm.mjs test /path/to/synergy-checkouts
```

The build emits stateful SynQ IR v2, ABI JSON, and a manifest under `artifacts/`. The manifest targets Synergy Testnet v3, chain 1266, and the ML-DSA-87 account signature domain. Tests call the pinned stateful AIVM directly with synthetic callers and an in-memory ledger. They cover a complete 24-turn game, both winning seats, fees, rent, lap income, purchase and upgrade rules, turn permissions, and rollback when a call reverts.

## Native SNRG settlement

The pinned AIVM accepts `msg.value` from its execution context and can emit a `sendNative` receipt in nWei. Its upstream local fixture passes 10 nWei in the execution context and checks a 7 nWei receipt. The fixture injects the incoming value directly. The pinned SynQ V1 call envelope has fields for the contract, method selector and argument hash. Its inner signature does not bind native value. Public deployment and canonical receipts for general-purpose SynQ contracts still await a verified Testnet v3 admission path. [Synergy Forge AIVM runtime status](https://forge.synergy-network.io/build/aivm/overview) · [Synergy CLI capabilities](https://forge.synergy-network.io/tools/cli)

A native mode needs a wallet-approved transaction path that binds the amount, caller, contract and action, and commits the sender debit and game escrow credit atomically. Store amounts as integers in nWei, where 1 SNRG equals 1,000,000,000 nWei. Use confirmed deposits to fund player balances and a separately funded city reserve for grants and lap income. Settle property charges, upgrades and rent against those balances. Define insolvency, timeouts and refunds before enabling deposits, then verify withdrawal and settlement receipts on Testnet. The game ranks players by net worth and does not require issuance or a winner payout.
