use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const NEAR: u128 = 10u128.pow(24);
const FEE: u128 = NEAR; // 1 NEAR entry
const MIN: u64 = 60_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn arena_id() -> AccountId {
    acc("arena.testnet")
}
fn hash(tag: &str) -> String {
    sha256_hex(tag.as_bytes())
}
fn seed() -> Vec<u8> {
    vec![7u8; 32]
}

fn ctx(predecessor: &str, deposit: u128, now_ms: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(arena_id())
        .predecessor_account_id(acc(predecessor))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(now_ms * 1_000_000)
        .build());
}

fn setup(agents: &[(&str, &str)]) -> Arena {
    ctx("operator.testnet", 0, 1_000);
    let mut arena = Arena::new(acc("operator.testnet"), U128(NEAR / 10), U128(NEAR / 4));
    for (agent, owner) in agents {
        ctx("arena.testnet", 0, 1_000);
        assert!(arena.on_agent_created(acc(agent), acc(owner), Ok(())));
        ctx(owner, 3 * FEE, 1_000);
        arena.deposit(acc(agent));
    }
    arena
}

fn roster(agents: &[&str]) -> Vec<RosterSeat> {
    agents
        .iter()
        .map(|a| RosterSeat {
            agent: acc(a),
            config_hash: hash(a),
        })
        .collect()
}

fn create(arena: &mut Arena, agents: &[&str], shares: Vec<u16>) -> Tournament {
    ctx("operator.testnet", 0, 1_000);
    arena.create_tournament(
        "t1".into(),
        hash("rules"),
        sha256_hex(&seed()),
        U128(FEE),
        roster(agents),
        shares,
        15 * MIN,
        10 * MIN,
        60 * MIN,
    )
}

const A: &str = "alpha.arena.testnet";
const B: &str = "bravo.arena.testnet";
const C: &str = "charlie.arena.testnet";

fn three() -> Arena {
    setup(&[
        (A, "alice.testnet"),
        (B, "bob.testnet"),
        (C, "carol.testnet"),
    ])
}

#[test]
fn full_roster_starts_and_finalizes_with_exact_payouts() {
    let mut arena = three();
    create(&mut arena, &[A, B, C], vec![7000, 3000]);
    for a in [A, B, C] {
        ctx(a, 0, 2_000);
        arena.enter("t1".into());
    }
    let t = arena.get_tournament("t1".into()).unwrap();
    assert_eq!(t.state, TournamentState::Running);
    assert_eq!(t.prize_pool.0, 3 * FEE);

    ctx("operator.testnet", 0, 11 * MIN);
    let t = arena.finalize(
        "t1".into(),
        hash("result"),
        hash("replay"),
        to_hex(&seed()),
        vec![acc(B), acc(A)],
    );
    assert_eq!(t.state, TournamentState::Finalized);
    let paid: u128 = t.payouts.iter().map(|p| p.amount.0).sum();
    assert_eq!(paid, 3 * FEE);
    let b = arena.get_agent(acc(B)).unwrap();
    assert_eq!(b.balance.0, 2 * FEE + 3 * FEE * 7 / 10);
    assert_eq!(b.wins, 1);
    assert_eq!(arena.get_agent(acc(C)).unwrap().balance.0, 2 * FEE);
}

#[test]
#[should_panic(expected = "SEED_MISMATCH")]
fn finalize_rejects_wrong_seed() {
    let mut arena = three();
    create(&mut arena, &[A, B], vec![10000]);
    for a in [A, B] {
        ctx(a, 0, 2_000);
        arena.enter("t1".into());
    }
    ctx("operator.testnet", 0, 11 * MIN);
    arena.finalize(
        "t1".into(),
        hash("r"),
        hash("p"),
        to_hex(&[1u8; 32]),
        vec![acc(A)],
    );
}

#[test]
#[should_panic(expected = "NOT_ENTRANT")]
fn finalize_rejects_non_entrant() {
    let mut arena = three();
    create(&mut arena, &[A, B, C], vec![10000]);
    for a in [A, B] {
        ctx(a, 0, 2_000);
        arena.enter("t1".into());
    }
    ctx("anyone.testnet", 0, 20 * MIN);
    arena.start("t1".into());
    ctx("operator.testnet", 0, 31 * MIN);
    arena.finalize(
        "t1".into(),
        hash("r"),
        hash("p"),
        to_hex(&seed()),
        vec![acc(C)],
    );
}

#[test]
#[should_panic(expected = "NOT_OPERATOR")]
fn only_operator_finalizes() {
    let mut arena = three();
    create(&mut arena, &[A, B], vec![10000]);
    for a in [A, B] {
        ctx(a, 0, 2_000);
        arena.enter("t1".into());
    }
    ctx(A, 0, 11 * MIN);
    arena.finalize(
        "t1".into(),
        hash("r"),
        hash("p"),
        to_hex(&seed()),
        vec![acc(A)],
    );
}

#[test]
#[should_panic(expected = "NOT_ON_ROSTER")]
fn off_roster_agent_cannot_enter() {
    let mut arena = three();
    create(&mut arena, &[A, B], vec![10000]);
    ctx(C, 0, 2_000);
    arena.enter("t1".into());
}

#[test]
#[should_panic(expected = "INSUFFICIENT_BALANCE")]
fn unfunded_agent_cannot_enter() {
    let mut arena = setup(&[(A, "alice.testnet"), (B, "bob.testnet")]);
    ctx("operator.testnet", 0, 1_000);
    arena.create_tournament(
        "t1".into(),
        hash("rules"),
        sha256_hex(&seed()),
        U128(10 * FEE),
        roster(&[A, B]),
        vec![10000],
        15 * MIN,
        10 * MIN,
        60 * MIN,
    );
    ctx(A, 0, 2_000);
    arena.enter("t1".into());
}

#[test]
#[should_panic(expected = "DUPLICATE_OWNER")]
fn one_owner_one_seat() {
    let mut arena = setup(&[(A, "alice.testnet"), (B, "alice.testnet")]);
    create(&mut arena, &[A, B], vec![10000]);
}

#[test]
#[should_panic(expected = "SHARES_NOT_100_PERCENT")]
fn shares_must_total_100_percent() {
    let mut arena = three();
    create(&mut arena, &[A, B], vec![6000, 3000]);
}

#[test]
fn unfilled_registration_cancels_and_refunds() {
    let mut arena = three();
    create(&mut arena, &[A, B, C], vec![10000]);
    ctx(A, 0, 2_000);
    arena.enter("t1".into());
    assert_eq!(arena.get_agent(acc(A)).unwrap().balance.0, 2 * FEE);
    ctx("anyone.testnet", 0, 20 * MIN);
    let t = arena.cancel("t1".into());
    assert_eq!(t.state, TournamentState::Cancelled);
    assert_eq!(arena.get_agent(acc(A)).unwrap().balance.0, 3 * FEE);
}

#[test]
fn expired_match_cancels_and_refunds() {
    let mut arena = three();
    create(&mut arena, &[A, B], vec![10000]);
    for a in [A, B] {
        ctx(a, 0, 2_000);
        arena.enter("t1".into());
    }
    ctx("anyone.testnet", 0, 2_000 + 71 * MIN);
    arena.cancel("t1".into());
    assert_eq!(arena.get_agent(acc(B)).unwrap().balance.0, 3 * FEE);
}

#[test]
#[should_panic(expected = "CANNOT_CANCEL")]
fn running_match_cannot_be_cancelled_early() {
    let mut arena = three();
    create(&mut arena, &[A, B], vec![10000]);
    for a in [A, B] {
        ctx(a, 0, 2_000);
        arena.enter("t1".into());
    }
    ctx("anyone.testnet", 0, 30 * MIN);
    arena.cancel("t1".into());
}

#[test]
fn withdraw_always_pays_owner() {
    let mut arena = three();
    ctx(A, 0, 2_000); // the agent's restricted key calls withdraw
    let _ = arena.withdraw(acc(A), U128(FEE));
    assert_eq!(arena.get_agent(acc(A)).unwrap().balance.0, 2 * FEE);
    // The resulting promise is a transfer to alice.testnet, never to the caller.
    let receipts = near_sdk::test_utils::get_created_receipts();
    assert!(receipts
        .iter()
        .any(|r| r.receiver_id == acc("alice.testnet")));
    ctx("arena.testnet", 0, 2_001);
    assert!(arena.on_withdraw_resolved(acc(A), U128(FEE), Ok(())));
    assert_eq!(arena.get_agent(acc(A)).unwrap().balance.0, 2 * FEE);
}

#[test]
#[should_panic(expected = "NOT_OWNER_OR_AGENT")]
fn stranger_cannot_withdraw() {
    let mut arena = three();
    ctx("mallory.testnet", 0, 2_000);
    let _ = arena.withdraw(acc(A), U128(1));
}

#[test]
fn roster_hash_is_order_independent() {
    let forward = roster_hash(&roster(&[A, B, C]));
    let reverse = roster_hash(&roster(&[C, B, A]));
    assert_eq!(forward, reverse);
}

#[test]
#[should_panic(expected = "INVALID_AGENT_NAME")]
fn agent_names_are_validated() {
    let mut arena = three();
    ctx("operator.testnet", 0, 1_000);
    let pk: PublicKey = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp"
        .parse()
        .unwrap();
    let pk2: PublicKey = "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847"
        .parse()
        .unwrap();
    let _ = arena.create_agent("Bad.Name".into(), acc("alice.testnet"), pk, pk2);
}

#[test]
fn create_agent_issues_restricted_server_key() {
    let mut arena = three();
    ctx("operator.testnet", NEAR / 10, 1_000);
    let owner_pk: PublicKey = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp"
        .parse()
        .unwrap();
    let server_pk: PublicKey = "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847"
        .parse()
        .unwrap();
    let _ = arena.create_agent("delta".into(), acc("dave.testnet"), owner_pk, server_pk);
    let receipts = near_sdk::test_utils::get_created_receipts();
    let create = receipts
        .iter()
        .find(|r| r.receiver_id == acc("delta.arena.testnet"))
        .unwrap();
    let debug = format!("{:?}", create.actions);
    assert!(debug.contains("CreateAccount"));
    assert!(
        debug.contains(r#"method_names: ["enter", "withdraw"]"#),
        "server key must be limited to enter/withdraw: {debug}"
    );
    assert!(debug.contains("arena.testnet"));
}

#[test]
fn roster_hash_matches_typescript() {
    // Same vector as tests/near.test.ts in the arena server.
    let roster = vec![
        RosterSeat {
            agent: acc("bravo.arena.testnet"),
            config_hash: "b".repeat(64),
        },
        RosterSeat {
            agent: acc("alpha.arena.testnet"),
            config_hash: "a".repeat(64),
        },
    ];
    assert_eq!(
        roster_hash(&roster),
        "6f14f0fd6a316dcd9d482f5b1c58ede47aae619212a4a4aadfb28812af6bbf61"
    );
}

#[test]
fn seed_reveal_uses_sha256_of_raw_bytes() {
    // The server commits sha256(32 random bytes) and reveals the bytes as hex.
    let seed = [0xabu8; 32];
    assert_eq!(
        sha256_hex(&from_hex(&to_hex(&seed)).unwrap()),
        sha256_hex(&seed)
    );
}

// ---------- OutLayer VRF ----------

use ed25519_dalek::{Signer, SigningKey};

fn vrf_key() -> SigningKey {
    SigningKey::from_bytes(&[9u8; 32])
}

fn with_vrf(arena: &mut Arena) {
    ctx("arena.testnet", 0, 1_000);
    arena.set_randomness_source(Some(RandomnessSource {
        outlayer: acc("outlayer.testnet"),
        project_id: "arena.testnet/vrf".into(),
        vrf_pubkey_hex: to_hex(vrf_key().verifying_key().as_bytes()),
    }));
}

fn running(arena: &mut Arena) {
    create(arena, &[A, B], vec![10000]);
    for a in [A, B] {
        ctx(a, 0, 2_000);
        arena.enter("t1".into());
    }
}

fn vrf_response(alpha: &str, key: &SigningKey) -> VrfResponse {
    let sig = key.sign(alpha.as_bytes());
    VrfResponse {
        results: vec![VrfEntry {
            value: near_sdk::serde_json::json!(null),
            signature_hex: to_hex(&sig.to_bytes()),
            alpha: alpha.into(),
        }],
    }
}

#[test]
fn verified_vrf_is_stored_and_unlocks_finalize() {
    let mut arena = three();
    with_vrf(&mut arena);
    running(&mut arena);
    ctx("operator.testnet", MIN_VRF_FEE, 3_000);
    let _ = arena.request_randomness("t1".into());
    ctx("arena.testnet", 0, 3_100);
    let alpha = format!("vrf:42:arena.testnet:{}", vrf_seed("t1"));
    assert!(arena.on_randomness("t1".into(), Ok(Some(vrf_response(&alpha, &vrf_key())))));
    let r = arena
        .get_tournament("t1".into())
        .unwrap()
        .randomness
        .unwrap();
    assert_eq!(r.status, "verified");
    let sig = vrf_key().sign(alpha.as_bytes()).to_bytes();
    assert_eq!(r.output_hex.unwrap(), sha256_hex(&sig));
    ctx("operator.testnet", 0, 11 * MIN);
    arena.finalize(
        "t1".into(),
        hash("r"),
        hash("p"),
        to_hex(&seed()),
        vec![acc(A)],
    );
}

#[test]
fn forged_or_misbound_vrf_is_rejected_and_retry_allowed() {
    let mut arena = three();
    with_vrf(&mut arena);
    running(&mut arena);
    ctx("operator.testnet", MIN_VRF_FEE, 3_000);
    let _ = arena.request_randomness("t1".into());
    ctx("arena.testnet", 0, 3_100);
    let forger = SigningKey::from_bytes(&[1u8; 32]);
    let alpha = format!("vrf:42:arena.testnet:{}", vrf_seed("t1"));
    assert!(!arena.on_randomness("t1".into(), Ok(Some(vrf_response(&alpha, &forger)))));
    assert!(arena
        .get_tournament("t1".into())
        .unwrap()
        .randomness
        .is_none());
    // A genuine signature for another tournament's seed is rejected too.
    ctx("operator.testnet", MIN_VRF_FEE, 3_200);
    let _ = arena.request_randomness("t1".into());
    ctx("arena.testnet", 0, 3_300);
    let other = format!("vrf:43:arena.testnet:{}", vrf_seed("t2"));
    assert!(!arena.on_randomness("t1".into(), Ok(Some(vrf_response(&other, &vrf_key())))));
}

#[test]
#[should_panic(expected = "RANDOMNESS_ALREADY_REQUESTED")]
fn randomness_cannot_be_rerolled() {
    let mut arena = three();
    with_vrf(&mut arena);
    running(&mut arena);
    ctx("operator.testnet", MIN_VRF_FEE, 3_000);
    let _ = arena.request_randomness("t1".into());
    ctx("arena.testnet", 0, 3_100);
    let alpha = format!("vrf:42:arena.testnet:{}", vrf_seed("t1"));
    arena.on_randomness("t1".into(), Ok(Some(vrf_response(&alpha, &vrf_key()))));
    ctx("operator.testnet", MIN_VRF_FEE, 3_200);
    let _ = arena.request_randomness("t1".into());
}

#[test]
#[should_panic(expected = "RANDOMNESS_NOT_VERIFIED")]
fn finalize_requires_randomness_when_source_is_set() {
    let mut arena = three();
    with_vrf(&mut arena);
    running(&mut arena);
    ctx("operator.testnet", 0, 11 * MIN);
    arena.finalize(
        "t1".into(),
        hash("r"),
        hash("p"),
        to_hex(&seed()),
        vec![acc(A)],
    );
}

#[test]
#[should_panic(expected = "NOT_CONTRACT_OWNER")]
fn operator_cannot_change_vrf_key() {
    let mut arena = three();
    ctx("operator.testnet", 0, 1_000);
    arena.set_randomness_source(None);
}

// ---------- NEP-245 trophies ----------

#[test]
fn finalize_mints_soulbound_trophies() {
    let mut arena = three();
    create(&mut arena, &[A, B, C], vec![7000, 3000]);
    for a in [A, B, C] {
        ctx(a, 0, 2_000);
        arena.enter("t1".into());
    }
    ctx("operator.testnet", 0, 11 * MIN);
    arena.finalize(
        "t1".into(),
        hash("r"),
        hash("p"),
        to_hex(&seed()),
        vec![acc(B), acc(A)],
    );
    assert_eq!(arena.mt_balance_of(acc(B), "trophy:t1".into()).0, 1);
    assert_eq!(arena.mt_balance_of(acc(B), "champion".into()).0, 1);
    assert_eq!(arena.mt_balance_of(acc(A), "podium".into()).0, 1);
    assert_eq!(arena.mt_balance_of(acc(C), "podium".into()).0, 0);
    assert_eq!(arena.mt_supply("podium".into()).unwrap().0, 2);
    assert_eq!(
        arena.mt_token(vec!["trophy:t1".into()])[0]
            .as_ref()
            .unwrap()
            .owner_id,
        Some(acc(B))
    );
    assert_eq!(arena.mt_tokens_for_owner(acc(B)).len(), 3);
}

#[test]
#[should_panic(expected = "SOULBOUND")]
fn trophies_cannot_be_transferred() {
    let mut arena = three();
    ctx(B, 1, 1_000);
    arena.mt_transfer(acc(A), "champion".into(), U128(1));
}

fn agent_keys() -> (PublicKey, PublicKey) {
    (
        "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp"
            .parse()
            .unwrap(),
        "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847"
            .parse()
            .unwrap(),
    )
}

#[test]
#[should_panic(expected = "ATTACH_EXACT_AGENT_SEED")]
fn create_agent_cannot_spend_escrow() {
    // Arena balances are held by the contract; a new agent account must be paid for by the operator.
    let mut arena = three();
    ctx("operator.testnet", 0, 1_000);
    let (owner_pk, server_pk) = agent_keys();
    let _ = arena.create_agent("delta".into(), acc("dave.testnet"), owner_pk, server_pk);
}

#[test]
#[should_panic(expected = "ATTACH_EXACT_AGENT_SEED")]
fn create_agent_rejects_overpayment() {
    let mut arena = three();
    ctx("operator.testnet", NEAR, 1_000);
    let (owner_pk, server_pk) = agent_keys();
    let _ = arena.create_agent("delta".into(), acc("dave.testnet"), owner_pk, server_pk);
}

#[test]
fn create_agent_forwards_exactly_the_attached_seed() {
    let mut arena = three();
    ctx("operator.testnet", NEAR / 10, 1_000);
    let (owner_pk, server_pk) = agent_keys();
    let _ = arena.create_agent("delta".into(), acc("dave.testnet"), owner_pk, server_pk);
    let receipts = near_sdk::test_utils::get_created_receipts();
    let create = receipts
        .iter()
        .find(|r| r.receiver_id == acc("delta.arena.testnet"))
        .unwrap();
    let debug = format!("{:?}", create.actions);
    assert!(
        debug.contains(&format!("deposit: NearToken {{ inner: {} }}", NEAR / 10)),
        "{debug}"
    );
    assert!(arena.get_config().operator_funds_agents);
}

#[test]
fn failed_agent_creation_refunds_the_operator() {
    let mut arena = three();
    ctx("arena.testnet", 0, 1_000);
    assert!(!arena.on_agent_created(
        acc("delta.arena.testnet"),
        acc("dave.testnet"),
        Err(PromiseError::Failed)
    ));
    assert!(arena.get_agent(acc("delta.arena.testnet")).is_none());
    let refund = near_sdk::test_utils::get_created_receipts()
        .into_iter()
        .find(|r| r.receiver_id == acc("operator.testnet"));
    let debug = format!("{:?}", refund.expect("refund to operator").actions);
    assert!(debug.contains(&format!("{}", NEAR / 10)), "{debug}");
}

// ---------- OutLayer-verified settlement ----------

fn with_verifier(arena: &mut Arena) {
    ctx("arena.testnet", 0, 1_000);
    arena.set_settlement_verifier(Some(SettlementVerifier {
        outlayer: acc("outlayer.testnet"),
        project_id: "arena.testnet/replay".into(),
    }));
}

fn hands() -> Vec<String> {
    vec!["c k k k".into(), "r60 f".into()]
}

fn propose(arena: &mut Arena, ranking: Vec<AccountId>) {
    ctx("operator.testnet", MIN_VRF_FEE, 11 * MIN);
    let _ = arena.finalize_verified(
        "t1".into(),
        hash("result"),
        to_hex(&seed()),
        ranking,
        "{}".into(),
        vec![],
        hands(),
    );
}

fn replay_out(ranking: &[&str]) -> ReplayOutput {
    ReplayOutput {
        tournament_id: "t1".into(),
        ok: true,
        error: None,
        ranking: ranking.iter().map(|s| s.to_string()).collect(),
        replay_hash: sha256_hex(hands().join("\n").as_bytes()),
    }
}

#[test]
#[should_panic(expected = "VERIFIED_SETTLEMENT_REQUIRED")]
fn verifier_blocks_operator_asserted_finalize() {
    let mut arena = three();
    with_verifier(&mut arena);
    running(&mut arena);
    ctx("operator.testnet", 0, 11 * MIN);
    arena.finalize(
        "t1".into(),
        hash("r"),
        hash("p"),
        to_hex(&seed()),
        vec![acc(A)],
    );
}

#[test]
fn matching_replay_pays_and_marks_verified() {
    let mut arena = three();
    with_verifier(&mut arena);
    running(&mut arena);
    propose(&mut arena, vec![acc(B)]);
    assert!(arena.get_settlement_status("t1".into()).in_flight);
    assert_eq!(
        arena.get_tournament("t1".into()).unwrap().state,
        TournamentState::Running
    );
    ctx("arena.testnet", 0, 11 * MIN + 1);
    assert!(arena.on_settlement_checked("t1".into(), Ok(Some(replay_out(&[B])))));
    let t = arena.get_tournament("t1".into()).unwrap();
    assert_eq!(t.state, TournamentState::Finalized);
    assert_eq!(
        t.replay_hash.unwrap(),
        sha256_hex(hands().join("\n").as_bytes())
    );
    assert_eq!(
        arena.get_agent(acc(B)).unwrap().balance.0,
        2 * FEE + 2 * FEE
    );
    let s = arena.get_settlement_status("t1".into());
    assert!(s.verified && !s.in_flight && s.last_rejection.is_none());
}

#[test]
fn mismatched_or_failed_replay_pays_nothing_and_allows_a_new_proposal() {
    let mut arena = three();
    with_verifier(&mut arena);
    running(&mut arena);
    propose(&mut arena, vec![acc(A)]);
    ctx("arena.testnet", 0, 11 * MIN + 1);
    assert!(!arena.on_settlement_checked("t1".into(), Ok(Some(replay_out(&[B])))));
    let s = arena.get_settlement_status("t1".into());
    assert!(!s.verified && !s.in_flight);
    assert!(s.last_rejection.unwrap().starts_with("RANKING_MISMATCH"));
    assert_eq!(
        arena.get_tournament("t1".into()).unwrap().state,
        TournamentState::Running
    );
    assert_eq!(arena.get_agent(acc(A)).unwrap().balance.0, 2 * FEE);

    propose(&mut arena, vec![acc(B)]);
    ctx("arena.testnet", 0, 11 * MIN + 2);
    assert!(!arena.on_settlement_checked("t1".into(), Ok(None)));
    assert_eq!(
        arena
            .get_settlement_status("t1".into())
            .last_rejection
            .unwrap(),
        "OUTLAYER_NO_RESULT"
    );

    propose(&mut arena, vec![acc(B)]);
    let mut bad = replay_out(&[B]);
    bad.replay_hash = hash("other log");
    ctx("arena.testnet", 0, 11 * MIN + 3);
    assert!(!arena.on_settlement_checked("t1".into(), Ok(Some(bad))));

    propose(&mut arena, vec![acc(B)]);
    ctx("arena.testnet", 0, 11 * MIN + 4);
    assert!(arena.on_settlement_checked("t1".into(), Ok(Some(replay_out(&[B])))));
}

#[test]
#[should_panic(expected = "SETTLEMENT_CHECK_IN_FLIGHT")]
fn one_settlement_check_at_a_time() {
    let mut arena = three();
    with_verifier(&mut arena);
    running(&mut arena);
    propose(&mut arena, vec![acc(B)]);
    propose(&mut arena, vec![acc(A)]);
}

#[test]
#[should_panic(expected = "NOT_OPERATOR")]
fn only_operator_proposes_verified_settlement() {
    let mut arena = three();
    with_verifier(&mut arena);
    running(&mut arena);
    ctx(A, MIN_VRF_FEE, 11 * MIN);
    let _ = arena.finalize_verified(
        "t1".into(),
        hash("r"),
        to_hex(&seed()),
        vec![acc(A)],
        "{}".into(),
        vec![],
        hands(),
    );
}

#[test]
#[should_panic(expected = "ATTACH_0.05_NEAR_FOR_OUTLAYER")]
fn verified_settlement_requires_outlayer_fee() {
    let mut arena = three();
    with_verifier(&mut arena);
    running(&mut arena);
    ctx("operator.testnet", 0, 11 * MIN);
    let _ = arena.finalize_verified(
        "t1".into(),
        hash("r"),
        to_hex(&seed()),
        vec![acc(A)],
        "{}".into(),
        vec![],
        hands(),
    );
}

#[test]
#[should_panic(expected = "NOT_CONTRACT_OWNER")]
fn operator_cannot_change_settlement_verifier() {
    let mut arena = three();
    ctx("operator.testnet", 0, 1_000);
    arena.set_settlement_verifier(None);
}

#[test]
fn late_replay_after_cancel_pays_nothing() {
    let mut arena = three();
    with_verifier(&mut arena);
    running(&mut arena);
    propose(&mut arena, vec![acc(B)]);
    ctx("anyone.testnet", 0, 2_000 + 85 * MIN);
    arena.cancel("t1".into());
    ctx("arena.testnet", 0, 2_000 + 86 * MIN);
    assert!(!arena.on_settlement_checked("t1".into(), Ok(Some(replay_out(&[B])))));
    assert_eq!(
        arena.get_tournament("t1".into()).unwrap().state,
        TournamentState::Cancelled
    );
    assert_eq!(arena.get_agent(acc(B)).unwrap().balance.0, 3 * FEE);
}

#[test]
fn failed_withdrawal_restores_balance_without_overwriting_new_deposits() {
    let mut arena = three();
    ctx(A, 0, 2_000);
    let _ = arena.withdraw(acc(A), U128(FEE));
    ctx("alice.testnet", FEE, 2_001);
    arena.deposit(acc(A));
    ctx("arena.testnet", 0, 2_002);
    assert!(!arena.on_withdraw_resolved(acc(A), U128(FEE), Err(PromiseError::Failed)));
    assert_eq!(arena.get_agent(acc(A)).unwrap().balance.0, 4 * FEE);
}

#[test]
#[should_panic(expected = "CANNOT_FINALIZE")]
fn cannot_settle_before_clock_expires() {
    let mut arena = three();
    running(&mut arena);
    ctx("operator.testnet", 0, 5 * MIN);
    arena.finalize(
        "t1".into(),
        hash("r"),
        hash("p"),
        to_hex(&seed()),
        vec![acc(A)],
    );
}

#[test]
#[should_panic(expected = "EMPTY_REPLAY")]
fn verified_settlement_rejects_empty_match() {
    let mut arena = three();
    with_verifier(&mut arena);
    running(&mut arena);
    ctx("operator.testnet", MIN_VRF_FEE, 11 * MIN);
    let _ = arena.finalize_verified(
        "t1".into(),
        hash("r"),
        to_hex(&seed()),
        vec![acc(A)],
        "{}".into(),
        vec![],
        vec![],
    );
}

#[test]
fn unavailable_vrf_refunds_at_playing_deadline_and_ignores_late_callback() {
    let mut arena = three();
    with_vrf(&mut arena);
    running(&mut arena);
    ctx("operator.testnet", MIN_VRF_FEE, 3_000);
    let _ = arena.request_randomness("t1".into());

    // Disabling the global source only affects newly created matches.
    ctx("arena.testnet", 0, 4_000);
    arena.set_randomness_source(None);
    let policy = arena
        .get_tournament_verification_config("t1".into())
        .unwrap();
    assert_eq!(policy["pinned"], true);
    assert!(!policy["randomness_source"].is_null());

    ctx("spectator.testnet", 0, 2_000 + 10 * MIN);
    let t = arena.cancel("t1".into());
    assert_eq!(t.state, TournamentState::Cancelled);
    assert_eq!(t.prize_pool.0, 0);
    for a in [A, B] {
        assert_eq!(arena.get_agent(acc(a)).unwrap().balance.0, 3 * FEE);
    }

    ctx("arena.testnet", 0, 2_001 + 10 * MIN);
    let alpha = format!("vrf:42:arena.testnet:{}", vrf_seed("t1"));
    assert!(!arena.on_randomness("t1".into(), Ok(Some(vrf_response(&alpha, &vrf_key())))));
    assert_eq!(
        arena.get_tournament("t1".into()).unwrap().state,
        TournamentState::Cancelled
    );
}

#[test]
#[should_panic(expected = "VERIFIED_SETTLEMENT_REQUIRED")]
fn existing_tournament_keeps_verifier_after_global_change() {
    let mut arena = three();
    with_verifier(&mut arena);
    running(&mut arena);
    ctx("arena.testnet", 0, 4_000);
    arena.set_settlement_verifier(None);
    ctx("operator.testnet", 0, 11 * MIN);
    arena.finalize(
        "t1".into(),
        hash("r"),
        hash("p"),
        to_hex(&seed()),
        vec![acc(A)],
    );
}
