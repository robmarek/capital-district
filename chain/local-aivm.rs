use compiler::{analyze, parse, ArtifactBundle, CodeGenerator};
use std::fs;

const SOURCE: &str = include_str!("CapitalDistrict.synq");

fn compile() -> ArtifactBundle {
    let (_, ast) = parse(SOURCE).expect("parse CapitalDistrict");
    analyze(&ast).expect("analyze CapitalDistrict");
    let code = CodeGenerator::new()
        .generate_stateful(&ast)
        .expect("generate stateful SynQ IR");
    ArtifactBundle::generate(SOURCE, &ast, code).expect("generate CapitalDistrict artifacts")
}

fn main() -> std::io::Result<()> {
    let bundle = compile();
    fs::create_dir_all("artifacts")?;
    fs::write("artifacts/CapitalDistrict.compiled.synq", &bundle.bytecode)?;
    fs::write(
        "artifacts/CapitalDistrict.abi.json",
        bundle.abi_json().expect("serialize ABI"),
    )?;
    fs::write(
        "artifacts/CapitalDistrict.manifest.json",
        bundle.manifest_json().expect("serialize manifest"),
    )?;
    println!("SynQ stateful IR v2 · Synergy Testnet-v3 · chain 1266");
    println!("Bytecode SHA-256 {}", bundle.hashes.bytecode_hash);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use aivm_core::execution::{ExecutionRequest, ExecutionStatus};
    use aivm_core::state::ContractState;
    use aivm_core::stateful_synq::SynQValue;
    use aivm_core::synq_runtime::{call_synq_contract, deploy_synq_contract, SynQRuntimeReceipt};
    use serde_json::{json, Value};

    const ALICE: &str = "capital-district-test-alice";
    const BOB: &str = "capital-district-test-bob";
    const VISITOR: &str = "capital-district-test-visitor";

    struct Match {
        bundle: ArtifactBundle,
        state: ContractState,
    }

    impl Match {
        fn new() -> Self {
            let mut game = Self {
                bundle: compile(),
                state: ContractState::default(),
            };
            let receipt =
                deploy_synq_contract(&game.request(ALICE, b"[]".to_vec()), &mut game.state);
            assert_eq!(
                receipt.status,
                ExecutionStatus::Succeeded,
                "{:?}",
                receipt.error
            );
            game
        }

        fn request(&self, caller: &str, calldata: Vec<u8>) -> ExecutionRequest {
            let mut request = ExecutionRequest::synq(
                "capital-district-local",
                self.bundle.bytecode.clone(),
                1_000_000,
            );
            request.artifact.abi_json =
                Some(String::from_utf8(self.bundle.abi_json().unwrap()).unwrap());
            request.artifact.manifest_json =
                Some(String::from_utf8(self.bundle.manifest_json().unwrap()).unwrap());
            request.context.runtime_block_height = 1;
            request.context.block_height = 1;
            request.context.caller = caller.as_bytes().to_vec();
            request.calldata = calldata;
            request
        }

        fn calldata(&self, method: &str, args: Value) -> Vec<u8> {
            let selector = self
                .bundle
                .abi
                .methods
                .iter()
                .find(|entry| entry.name == method)
                .unwrap_or_else(|| panic!("ABI method {method}"))
                .selector
                .trim_start_matches("0x");
            let mut calldata = (0..selector.len())
                .step_by(2)
                .map(|index| u8::from_str_radix(&selector[index..index + 2], 16).unwrap())
                .collect::<Vec<_>>();
            calldata.extend(serde_json::to_vec(&args).unwrap());
            calldata
        }

        fn execute(&mut self, caller: &str, method: &str, args: Value) -> SynQRuntimeReceipt {
            let request = self.request(caller, self.calldata(method, args));
            call_synq_contract(&request, &mut self.state)
        }

        fn call(&mut self, caller: &str, method: &str, args: Value) -> SynQValue {
            let receipt = self.execute(caller, method, args);
            assert_eq!(
                receipt.status,
                ExecutionStatus::Succeeded,
                "{method}: {:?}",
                receipt.error
            );
            assert!(receipt.native_transfers.is_empty());
            serde_json::from_slice(&receipt.return_data).unwrap()
        }

        fn get(&mut self, method: &str, args: Value) -> u128 {
            let value = self.call(VISITOR, method, args);
            let SynQValue::Uint(number) = value else {
                panic!("Expected integer from {method}: {value:?}")
            };
            number
        }

        fn reject(&mut self, caller: &str, method: &str, args: Value, reason: &str) {
            let before = self.state.state_root();
            let receipt = self.execute(caller, method, args);
            assert_eq!(
                receipt.status,
                ExecutionStatus::Reverted,
                "{method}: {:?}",
                receipt.error
            );
            assert!(receipt.error.unwrap_or_default().contains(reason));
            assert_eq!(self.state.state_root(), before);
            assert_eq!(receipt.pre_state_root, receipt.post_state_root);
        }
    }

    #[test]
    fn lobby_turn_permissions_and_purchase_guards() {
        let mut game = Match::new();
        assert_eq!(game.get("gamePhase", json!([])), 0);
        assert_eq!(
            game.call(VISITOR, "playerAccount", json!(["1"])),
            SynQValue::Address(ALICE.into())
        );
        assert_eq!(game.get("playerCash", json!(["1"])), 1500);
        assert_eq!(game.get("playerCash", json!(["2"])), 0);
        game.reject(ALICE, "join", json!([]), "Second account");
        game.reject(ALICE, "roll", json!([]), "Roll unavailable");
        game.call(BOB, "join", json!([]));
        assert_eq!(game.get("gamePhase", json!([])), 1);
        game.reject(VISITOR, "join", json!([]), "Seats are filled");
        game.reject(BOB, "roll", json!([]), "Not your turn");
        game.reject(ALICE, "buy", json!([]), "Roll before buying");
        game.reject(ALICE, "endTurn", json!([]), "Roll before ending");
        assert_eq!(game.call(ALICE, "roll", json!([])), SynQValue::Uint(2));
        assert_eq!(game.get("lastRoll", json!([])), 11);
        game.reject(ALICE, "roll", json!([]), "Roll unavailable");
        game.reject(BOB, "buy", json!([]), "Not your turn");
        game.reject(ALICE, "upgrade", json!(["2"]), "You must own");
        game.call(ALICE, "buy", json!([]));
        game.reject(ALICE, "buy", json!([]), "Property unavailable");
        assert_eq!(game.get("playerCash", json!(["1"])), 1370);
        game.call(ALICE, "upgrade", json!(["2"]));
        assert_eq!(game.get("playerCash", json!(["1"])), 1300);
        assert_eq!(game.get("playerAssetValue", json!(["1"])), 200);
        assert_eq!(game.get("propertyLevel", json!(["2"])), 1);
        assert_eq!(game.get("propertyRent", json!(["2"])), 50);
        game.reject(ALICE, "upgrade", json!(["2"]), "Upgrade unavailable");
        game.reject(BOB, "endTurn", json!([]), "Not your turn");
        game.call(ALICE, "endTurn", json!([]));
        assert_eq!(game.get("completedTurns", json!([])), 1);
        assert_eq!(game.call(BOB, "roll", json!([])), SynQValue::Uint(4));
    }

    #[test]
    fn attached_native_value_reverts_without_changing_state() {
        let mut game = Match::new();
        let mut blank = ContractState::default();
        let mut deploy = game.request(ALICE, b"[]".to_vec());
        deploy.context.call_value = 1_000_000_000;
        let receipt = deploy_synq_contract(&deploy, &mut blank);
        assert_eq!(receipt.status, ExecutionStatus::Reverted);
        assert!(receipt
            .error
            .unwrap_or_default()
            .contains("Practice SNRG only"));
        assert_eq!(blank, ContractState::default());

        let before = game.state.state_root();
        for method in ["join", "gamePhase"] {
            let mut request = game.request(BOB, game.calldata(method, json!([])));
            request.context.call_value = 1_000_000_000;
            let receipt = call_synq_contract(&request, &mut game.state);
            assert_eq!(
                receipt.status,
                ExecutionStatus::Reverted,
                "{method}: {:?}",
                receipt.error
            );
            assert!(receipt
                .error
                .unwrap_or_default()
                .contains("Practice SNRG only"));
            assert!(receipt.native_transfers.is_empty());
            assert_eq!(game.state.state_root(), before);
        }
    }

    #[test]
    fn full_match_settles_taxes_income_rent_and_final_score() {
        let mut game = Match::new();
        game.call(BOB, "join", json!([]));
        let landings = [
            2, 4, 9, 8, 15, 16, 3, 0, 5, 12, 13, 1, 19, 11, 10, 18, 17, 3, 6, 7, 14, 12, 4, 2,
        ];
        for (turn, landing) in landings.into_iter().enumerate() {
            let caller = if turn % 2 == 0 { ALICE } else { BOB };
            let roll = game.execute(caller, "roll", json!([]));
            assert_eq!(
                roll.status,
                ExecutionStatus::Succeeded,
                "turn {turn}: {:?}",
                roll.error
            );
            assert_eq!(
                serde_json::from_slice::<SynQValue>(&roll.return_data).unwrap(),
                SynQValue::Uint(landing)
            );
            if turn == 0 || turn == 1 {
                game.call(caller, "buy", json!([]));
            }
            if turn == 0 || turn == 2 {
                game.call(caller, "upgrade", json!(["2"]));
            }
            if turn == 4 {
                game.reject(caller, "upgrade", json!(["2"]), "Upgrade limit reached");
            }
            if turn == 6 {
                assert_eq!(game.get("playerCash", json!(["1"])), 1355);
            }
            if turn == 7 {
                assert_eq!(game.get("playerCash", json!(["2"])), 1540);
            }
            if turn == 22 || turn == 23 {
                assert!(roll
                    .logs
                    .iter()
                    .any(|line| line.starts_with("synq.event.RentPaid=")));
            }
            game.call(caller, "endTurn", json!([]));
        }

        assert_eq!(game.get("gamePhase", json!([])), 3);
        assert_eq!(game.get("completedTurns", json!([])), 24);
        assert_eq!(game.get("winningSeat", json!([])), 1);
        assert_eq!(game.get("propertyUpgradeCost", json!(["2"])), 0);
        assert_eq!(game.get("playerCash", json!(["1"])), 2243);
        assert_eq!(game.get("playerAssetValue", json!(["1"])), 270);
        assert_eq!(game.get("playerCash", json!(["2"])), 2257);
        assert_eq!(game.get("playerAssetValue", json!(["2"])), 160);
        assert_eq!(game.get("playerDebt", json!(["1"])), 0);
        assert_eq!(game.get("playerDebt", json!(["2"])), 0);
        game.reject(ALICE, "roll", json!([]), "Roll unavailable");
    }

    #[test]
    fn investments_can_change_winning_seat() {
        let mut game = Match::new();
        game.call(BOB, "join", json!([]));
        for turn in 0..24 {
            let caller = if turn % 2 == 0 { ALICE } else { BOB };
            game.call(caller, "roll", json!([]));
            if turn == 1 {
                game.call(BOB, "buy", json!([]));
            }
            if turn == 1 || turn == 3 {
                game.call(BOB, "upgrade", json!(["4"]));
            }
            game.call(caller, "endTurn", json!([]));
        }
        assert_eq!(game.get("winningSeat", json!([])), 2);
        assert_eq!(game.get("playerCash", json!(["1"])), 2374);
        assert_eq!(game.get("playerCash", json!(["2"])), 2216);
        assert_eq!(game.get("playerAssetValue", json!(["2"])), 340);
    }
}
