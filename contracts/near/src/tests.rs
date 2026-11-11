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
    agents.iter().map(|a| RosterSeat { agent: acc(a), config_hash: hash(a) }).collect()
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
    setup(&[(A, "alice.testnet"), (B, "bob.testnet"), (C, "carol.testnet")])
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

    ctx("operator.testnet", 0, 5 * MIN);
    let t = arena.finalize("t1".into(), hash("result"), hash("replay"), to_hex(&seed()), vec![acc(B), acc(A)]);
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
    ctx("operator.testnet", 0, 5 * MIN);
    arena.finalize("t1".into(), hash("r"), hash("p"), to_hex(&[1u8; 32]), vec![acc(A)]);
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
    ctx("operator.testnet", 0, 21 * MIN);
    arena.finalize("t1".into(), hash("r"), hash("p"), to_hex(&seed()), vec![acc(C)]);
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
    ctx(A, 0, 5 * MIN);
    arena.finalize("t1".into(), hash("r"), hash("p"), to_hex(&seed()), vec![acc(A)]);
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
    arena.create_tournament("t1".into(), hash("rules"), sha256_hex(&seed()), U128(10 * FEE), roster(&[A, B]), vec![10000], 15 * MIN, 10 * MIN, 60 * MIN);
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
    arena.withdraw(acc(A), U128(FEE));
    assert_eq!(arena.get_agent(acc(A)).unwrap().balance.0, 2 * FEE);
    // The resulting promise is a transfer to alice.testnet, never to the caller.
    let receipts = near_sdk::test_utils::get_created_receipts();
    assert_eq!(receipts.last().unwrap().receiver_id, acc("alice.testnet"));
}

#[test]
#[should_panic(expected = "NOT_OWNER_OR_AGENT")]
fn stranger_cannot_withdraw() {
    let mut arena = three();
    ctx("mallory.testnet", 0, 2_000);
    arena.withdraw(acc(A), U128(1));
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
    let pk: PublicKey = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp".parse().unwrap();
    let pk2: PublicKey = "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847".parse().unwrap();
    arena.create_agent("Bad.Name".into(), acc("alice.testnet"), pk, pk2);
}

#[test]
fn create_agent_issues_restricted_server_key() {
    let mut arena = three();
    ctx("operator.testnet", 0, 1_000);
    let owner_pk: PublicKey = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp".parse().unwrap();
    let server_pk: PublicKey = "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847".parse().unwrap();
    arena.create_agent("delta".into(), acc("dave.testnet"), owner_pk, server_pk);
    let receipts = near_sdk::test_utils::get_created_receipts();
    let create = receipts.iter().find(|r| r.receiver_id == acc("delta.arena.testnet")).unwrap();
    let debug = format!("{:?}", create.actions);
    assert!(debug.contains("CreateAccount"));
    assert!(debug.contains(r#"method_names: ["enter", "withdraw"]"#), "server key must be limited to enter/withdraw: {debug}");
    assert!(debug.contains("arena.testnet"));
}

#[test]
fn roster_hash_matches_typescript() {
    // Same vector as tests/near.test.ts in the arena server.
    let roster = vec![
        RosterSeat { agent: acc("bravo.arena.testnet"), config_hash: "b".repeat(64) },
        RosterSeat { agent: acc("alpha.arena.testnet"), config_hash: "a".repeat(64) },
    ];
    assert_eq!(roster_hash(&roster), "6f14f0fd6a316dcd9d482f5b1c58ede47aae619212a4a4aadfb28812af6bbf61");
}

#[test]
fn seed_reveal_uses_sha256_of_raw_bytes() {
    // The server commits sha256(32 random bytes) and reveals the bytes as hex.
    let seed = [0xabu8; 32];
    assert_eq!(sha256_hex(&from_hex(&to_hex(&seed)).unwrap()), sha256_hex(&seed));
}
