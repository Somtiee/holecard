//! Holecard tournament replay. A faithful port of `src/engine/poker.ts` + `src/engine/hand.ts` that
//! re-deals every hand from the committed operator seed and the onchain VRF output, re-applies the
//! recorded actions (rejecting any illegal one), and derives the final ranking. The arena contract
//! sends this program the inputs it already trusts (seed reveal, VRF output, roster commitments) plus
//! the operator's action log, and pays prizes only if the replayed ranking equals the proposed one.

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};

type Card = (i32, u8); // (rank 2..=14, suit 0..=3)

#[derive(Deserialize)]
pub struct RosterSeat {
    pub agent: String,
    pub config_hash: String,
}

#[derive(Deserialize)]
pub struct Input {
    pub tournament_id: String,
    pub seed_hex: String,
    #[serde(default)]
    pub vrf_hex: Option<String>,
    pub rules_hash: String,
    pub rules: String,
    pub roster: Vec<RosterSeat>,
    pub entered: Vec<String>,
    pub configs: Vec<String>,
    pub hands: Vec<String>,
    pub places: usize,
}

#[derive(Serialize, Default)]
pub struct Output {
    pub tournament_id: String,
    pub ok: bool,
    pub error: Option<String>,
    pub ranking: Vec<String>,
    pub stacks: BTreeMap<String, i64>,
    pub hands: usize,
    pub replay_hash: String,
}

pub fn sha256_hex(data: &[u8]) -> String {
    to_hex(&Sha256::digest(data))
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn from_hex(value: &str) -> Option<Vec<u8>> {
    let value = value.strip_prefix("0x").unwrap_or(value);
    if value.len() % 2 != 0 {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&value[i..i + 2], 16).ok())
        .collect()
}

/// Mirrors `handSeed` in src/server/arena/commitments.ts.
pub fn hand_seed(
    seed_hex: &str,
    tournament_id: &str,
    hand: usize,
    vrf: Option<&str>,
) -> Result<String, String> {
    let key = from_hex(seed_hex).ok_or("INVALID_SEED")?;
    let mut mac = Hmac::<Sha256>::new_from_slice(&key).map_err(|_| "INVALID_SEED")?;
    let msg = match vrf {
        Some(v) => format!("{tournament_id}:{hand}:{v}"),
        None => format!("{tournament_id}:{hand}"),
    };
    mac.update(msg.as_bytes());
    Ok(to_hex(&mac.finalize().into_bytes()))
}

/// Mirrors `createDeck` for 256-bit hex seeds: sha256 counter stream + rejection-sampled Fisher-Yates.
pub fn create_deck(seed: &str) -> Vec<Card> {
    let mut cards: Vec<Card> = (0..4u8)
        .flat_map(|s| (2..=14).map(move |r| (r, s)))
        .collect();
    let (mut counter, mut offset, mut block) = (0u64, 32usize, [0u8; 32]);
    let mut next_word = || {
        if offset == 32 {
            block = Sha256::digest(format!("arena-deck-v1:{seed}:{counter}").as_bytes()).into();
            counter += 1;
            offset = 0;
        }
        let w = u32::from_be_bytes([
            block[offset],
            block[offset + 1],
            block[offset + 2],
            block[offset + 3],
        ]);
        offset += 4;
        w
    };
    for i in (1..cards.len()).rev() {
        let size = (i + 1) as u64;
        let limit = (1u64 << 32) - ((1u64 << 32) % size);
        let j = loop {
            let w = next_word() as u64;
            if w < limit {
                break (w % size) as usize;
            }
        };
        cards.swap(i, j);
    }
    cards
}

fn eval_five(cards: &[Card]) -> Vec<i32> {
    let mut values: Vec<i32> = cards.iter().map(|c| c.0).collect();
    values.sort_by(|a, b| b.cmp(a));
    let flush = cards.iter().all(|c| c.1 == cards[0].1);
    let mut counts: Vec<(i32, i32)> = Vec::new();
    for v in &values {
        match counts.iter_mut().find(|(x, _)| x == v) {
            Some(e) => e.1 += 1,
            None => counts.push((*v, 1)),
        }
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1).then(b.0.cmp(&a.0)));
    let mut uniq = values.clone();
    uniq.dedup();
    let mut straight = 0;
    if uniq.len() >= 5 {
        for i in 0..=uniq.len() - 5 {
            if uniq[i] - uniq[i + 4] == 4 {
                straight = uniq[i];
            }
        }
    }
    if [14, 2, 3, 4, 5].iter().all(|v| uniq.contains(v)) {
        straight = 5;
    }
    let g = |i: usize| counts[i];
    let rest = |from: usize| counts[from..].iter().map(|x| x.0).collect::<Vec<_>>();
    if flush && straight > 0 {
        return vec![8, straight];
    }
    if g(0).1 == 4 {
        return vec![7, g(0).0, g(1).0];
    }
    if g(0).1 == 3 && g(1).1 == 2 {
        return vec![6, g(0).0, g(1).0];
    }
    if flush {
        return [vec![5], values].concat();
    }
    if straight > 0 {
        return vec![4, straight];
    }
    if g(0).1 == 3 {
        return [vec![3, g(0).0], rest(1)].concat();
    }
    if g(0).1 == 2 && g(1).1 == 2 {
        return vec![2, g(0).0.max(g(1).0), g(0).0.min(g(1).0), g(2).0];
    }
    if g(0).1 == 2 {
        return [vec![1, g(0).0], rest(1)].concat();
    }
    [vec![0], values].concat()
}

pub fn compare_hands(a: &[i32], b: &[i32]) -> i32 {
    for i in 0..a.len().max(b.len()) {
        let d = a.get(i).copied().unwrap_or(0) - b.get(i).copied().unwrap_or(0);
        if d != 0 {
            return d;
        }
    }
    0
}

pub fn evaluate_hand(cards: &[Card]) -> Vec<i32> {
    let n = cards.len();
    let mut best = vec![-1];
    for a in 0..n - 4 {
        for b in a + 1..n - 3 {
            for c in b + 1..n - 2 {
                for d in c + 1..n - 1 {
                    for e in d + 1..n {
                        let s = eval_five(&[cards[a], cards[b], cards[c], cards[d], cards[e]]);
                        if compare_hands(&s, &best) > 0 {
                            best = s;
                        }
                    }
                }
            }
        }
    }
    best
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Act {
    Fold,
    Check,
    Call,
    Raise(i64),
    AllIn,
}

fn parse_hand(line: &str) -> Result<Vec<Act>, String> {
    line.split_whitespace()
        .map(|t| match t {
            "f" => Ok(Act::Fold),
            "k" => Ok(Act::Check),
            "c" => Ok(Act::Call),
            "a" => Ok(Act::AllIn),
            _ if t.starts_with('r') => t[1..]
                .parse::<i64>()
                .map(Act::Raise)
                .map_err(|_| format!("BAD_ACTION:{t}")),
            _ => Err(format!("BAD_ACTION:{t}")),
        })
        .collect()
}

struct Player {
    id: String,
    stack: i64,
    contribution: i64,
    folded: bool,
    hole: Vec<Card>,
}

/// Returns the accepted (action, amount) exactly like `validateAction`, or an error if illegal.
fn validate(
    stack: i64,
    street_bet: i64,
    highest: i64,
    act: Act,
    min_raise: i64,
    can_raise: bool,
) -> Result<(Act, i64), String> {
    if stack <= 0 {
        return Err("ACTOR_HAS_NO_CHIPS".into());
    }
    let due = (highest - street_bet).max(0);
    let maximum = street_bet + stack;
    let raise_ok = can_raise && stack > due && maximum >= highest + min_raise;
    let allin_ok = can_raise || stack <= due;
    match act {
        Act::Fold => Ok((Act::Fold, 0)),
        Act::Check if due == 0 => Ok((Act::Check, 0)),
        Act::Call if due > 0 => Ok((Act::Call, due.min(stack))),
        Act::Raise(t) if raise_ok && t >= highest + min_raise && t <= maximum => {
            Ok((Act::Raise(t), t))
        }
        Act::AllIn if allin_ok => Ok((Act::AllIn, stack)),
        _ => Err(format!("ILLEGAL_ACTION:{act:?}")),
    }
}

/// Port of `playHand` driven by recorded actions. `seats` are (id, stack) in seat order.
pub fn play_hand(
    seed: &str,
    seats: &[(String, i64)],
    button: usize,
    small_blind: i64,
    big_blind: i64,
    actions: &[Act],
) -> Result<Vec<(String, i64)>, String> {
    let n = seats.len();
    let mut deck = create_deck(seed);
    let mut take = || deck.pop().expect("deck");
    let mut players: Vec<Player> = seats
        .iter()
        .map(|(id, stack)| Player {
            id: id.clone(),
            stack: *stack,
            contribution: 0,
            folded: *stack <= 0,
            hole: vec![],
        })
        .collect();
    for _ in 0..2 {
        for i in 0..n {
            let p = &mut players[(button + i) % n];
            if !p.folded {
                p.hole.push(take());
            }
        }
    }
    let mut street = vec![0i64; n];
    let small = if n == 2 { button } else { (button + 1) % n };
    let big = (small + 1) % n;
    for (i, amount) in [(small, small_blind), (big, big_blind)] {
        let paid = players[i].stack.min(amount);
        players[i].stack -= paid;
        players[i].contribution += paid;
        street[i] = paid;
    }
    let active = |ps: &Vec<Player>| ps.iter().filter(|p| !p.folded).count();
    let mut community: Vec<Card> = vec![];
    let mut stage = 0; // 0 preflop, 1 flop, 2 turn, 3 river
    let mut current = *street.iter().max().unwrap();
    let mut min_raise = big_blind;
    let mut actor = if n == 2 { small } else { (big + 1) % n };
    let mut cursor = 0usize;
    let mut guard = 0;
    while active(&players) > 1 {
        guard += 1;
        if guard > 500 {
            return Err("HAND_ACTION_LIMIT".into());
        }
        let mut pending: HashSet<usize> = (0..n)
            .filter(|&i| !players[i].folded && players[i].stack > 0)
            .collect();
        let mut acted_at: HashMap<usize, i64> = HashMap::new();
        while !pending.is_empty() && active(&players) > 1 {
            let mut found = None;
            for k in 0..n {
                let c = (actor + k) % n;
                if pending.contains(&c) {
                    found = Some(c);
                    actor = (actor + k + 1) % n;
                    break;
                }
            }
            let Some(pi) = found else { break };
            let street_bet = street[pi];
            let other_can_bet =
                (0..n).any(|o| o != pi && !players[o].folded && players[o].stack > 0);
            if !other_can_bet && street_bet >= current {
                pending.remove(&pi);
                continue;
            }
            let can_raise = other_can_bet
                && acted_at
                    .get(&pi)
                    .map(|a| current - a >= min_raise)
                    .unwrap_or(true);
            let act = *actions.get(cursor).ok_or("ACTIONS_EXHAUSTED")?;
            cursor += 1;
            let (accepted, amount) = validate(
                players[pi].stack,
                street_bet,
                current,
                act,
                min_raise,
                can_raise,
            )?;
            let (prev_stack, prev_bet) = (players[pi].stack, street_bet);
            match accepted {
                Act::Fold => players[pi].folded = true,
                Act::Check => {}
                _ => {
                    let target = match accepted {
                        Act::Raise(t) => t,
                        Act::AllIn => street_bet + players[pi].stack.min(amount),
                        _ => street_bet + amount,
                    };
                    let spent = players[pi].stack.min((target - street_bet).max(0));
                    players[pi].stack -= spent;
                    players[pi].contribution += spent;
                    street[pi] = street_bet + spent;
                }
            }
            let updated = street[pi];
            pending.remove(&pi);
            if updated > current {
                let raise_by = updated - current;
                current = updated;
                if raise_by >= min_raise {
                    min_raise = raise_by;
                }
                for o in 0..n {
                    if o != pi && !players[o].folded && players[o].stack > 0 {
                        pending.insert(o);
                    }
                }
            }
            acted_at.insert(pi, current);
            if prev_stack == players[pi].stack
                && prev_bet == street[pi]
                && !matches!(accepted, Act::Check | Act::Fold)
            {
                return Err("ACTION_DID_NOT_CHANGE_STATE".into());
            }
        }
        if active(&players) <= 1 {
            break;
        }
        match stage {
            0 => {
                for _ in 0..3 {
                    community.push(take());
                }
            }
            1 | 2 => community.push(take()),
            _ => break,
        }
        stage += 1;
        current = 0;
        min_raise = big_blind;
        street.iter_mut().for_each(|s| *s = 0);
        actor = (button + 1) % n;
    }
    if cursor != actions.len() {
        return Err("UNUSED_ACTIONS".into());
    }
    if active(&players) > 1 {
        while community.len() < 5 {
            community.push(take());
        }
    }
    // Side pots, exactly like calculateSidePots + the payout loop in playHand.
    let mut levels: Vec<i64> = players
        .iter()
        .map(|p| p.contribution)
        .filter(|&c| c > 0)
        .collect();
    levels.sort();
    levels.dedup();
    let mut payouts = vec![0i64; n];
    let mut prior = 0;
    for level in levels {
        let contributors: Vec<usize> = (0..n)
            .filter(|&i| players[i].contribution >= level)
            .collect();
        let amount = (level - prior) * contributors.len() as i64;
        prior = level;
        let eligible: Vec<usize> = contributors
            .into_iter()
            .filter(|&i| !players[i].folded)
            .collect();
        if eligible.is_empty() {
            return Err("POT_WITHOUT_ELIGIBLE_PLAYER".into());
        }
        if eligible.len() == 1 {
            payouts[eligible[0]] += amount;
            continue;
        }
        let mut best: Option<Vec<i32>> = None;
        let mut winners: Vec<usize> = vec![];
        for &i in &eligible {
            let mut cards = players[i].hole.clone();
            cards.extend_from_slice(&community);
            let score = evaluate_hand(&cards);
            let cmp = best.as_ref().map(|b| compare_hands(&score, b)).unwrap_or(1);
            if cmp > 0 {
                best = Some(score);
                winners = vec![i];
            } else if cmp == 0 {
                winners.push(i);
            }
        }
        winners.sort_by(|a, b| players[*a].id.cmp(&players[*b].id));
        let each = amount / winners.len() as i64;
        let extra = (amount % winners.len() as i64) as usize;
        for (k, &w) in winners.iter().enumerate() {
            payouts[w] += each + if k < extra { 1 } else { 0 };
        }
    }
    Ok(players
        .iter()
        .enumerate()
        .map(|(i, p)| (p.id.clone(), p.stack + payouts[i]))
        .collect())
}

/// Final standings: survivors by stack, then busted players by the hand they busted in (later is
/// better), then by the stack they started that hand with, then by id. Mirrors src/engine/ranking.ts.
pub fn rank_players(
    stacks: &BTreeMap<String, i64>,
    busted: &HashMap<String, (usize, i64)>,
) -> Vec<String> {
    let mut alive: Vec<&String> = stacks
        .iter()
        .filter(|(_, s)| **s > 0)
        .map(|(id, _)| id)
        .collect();
    alive.sort_by(|a, b| stacks[*b].cmp(&stacks[*a]).then(a.cmp(b)));
    let mut out: Vec<&String> = stacks
        .iter()
        .filter(|(_, s)| **s <= 0)
        .map(|(id, _)| id)
        .collect();
    out.sort_by(|a, b| {
        let (ha, sa) = busted.get(*a).copied().unwrap_or((0, 0));
        let (hb, sb) = busted.get(*b).copied().unwrap_or((0, 0));
        hb.cmp(&ha).then(sb.cmp(&sa)).then(a.cmp(b))
    });
    alive.into_iter().chain(out).cloned().collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Rules {
    id: String,
    starting_stack: i64,
}

#[derive(Deserialize)]
struct AgentConfig {
    id: String,
    account: String,
}

pub fn replay(input: &Input) -> Result<Output, String> {
    if from_hex(&input.seed_hex).map(|s| s.len()) != Some(32) {
        return Err("INVALID_SEED".into());
    }
    if sha256_hex(input.rules.as_bytes()) != input.rules_hash {
        return Err("RULES_HASH_MISMATCH".into());
    }
    let rules: Rules = serde_json::from_str(&input.rules).map_err(|_| "INVALID_RULES")?;
    if rules.id != input.tournament_id || rules.starting_stack <= 0 {
        return Err("INVALID_RULES".into());
    }
    // Bind each entrant's internal id to its NEAR account through the onchain roster commitment.
    let mut id_of: HashMap<String, String> = HashMap::new();
    let mut account_of: HashMap<String, String> = HashMap::new();
    for raw in &input.configs {
        let hash = sha256_hex(raw.as_bytes());
        let cfg: AgentConfig = serde_json::from_str(raw).map_err(|_| "INVALID_CONFIG")?;
        if !input
            .roster
            .iter()
            .any(|s| s.agent == cfg.account && s.config_hash == hash)
        {
            return Err(format!("CONFIG_NOT_IN_ROSTER:{}", cfg.account));
        }
        if id_of.insert(cfg.account.clone(), cfg.id.clone()).is_some()
            || account_of.insert(cfg.id, cfg.account).is_some()
        {
            return Err("DUPLICATE_CONFIG".into());
        }
    }
    let mut stacks: BTreeMap<String, i64> = BTreeMap::new();
    for account in &input.entered {
        let id = id_of
            .get(account)
            .ok_or_else(|| format!("MISSING_CONFIG:{account}"))?;
        stacks.insert(id.clone(), rules.starting_stack);
    }
    if stacks.len() < 2 || input.places == 0 || input.places > stacks.len() {
        return Err("INVALID_FIELD".into());
    }
    if input.hands.is_empty() {
        return Err("EMPTY_REPLAY".into());
    }
    let total: i64 = stacks.values().sum();
    let mut busted: HashMap<String, (usize, i64)> = HashMap::new();
    for (k, line) in input.hands.iter().enumerate() {
        let hand = k + 1;
        // Seat order is the entrants' ids in byte order (Postgres uuid order), skipping busted players.
        let seats: Vec<(String, i64)> = stacks
            .iter()
            .filter(|(_, s)| **s > 0)
            .map(|(i, s)| (i.clone(), *s))
            .collect();
        if seats.len() < 2 {
            return Err(format!("HAND_AFTER_WINNER:{hand}"));
        }
        let level = (k / 10) as i64 + 1;
        let seed = hand_seed(
            &input.seed_hex,
            &input.tournament_id,
            hand,
            input.vrf_hex.as_deref(),
        )?;
        let actions = parse_hand(line)?;
        let after = play_hand(
            &seed,
            &seats,
            k % seats.len(),
            (10 * level).min(10_000),
            (20 * level).min(20_000),
            &actions,
        )
        .map_err(|e| format!("HAND_{hand}:{e}"))?;
        for (id, stack) in after {
            if stack <= 0 {
                busted.insert(id.clone(), (hand, stacks[&id]));
            }
            stacks.insert(id, stack);
        }
        if stacks.values().sum::<i64>() != total {
            return Err(format!("CHIPS_NOT_CONSERVED:{hand}"));
        }
    }
    let ranking = rank_players(&stacks, &busted);
    Ok(Output {
        tournament_id: input.tournament_id.clone(),
        ok: true,
        error: None,
        ranking: ranking
            .iter()
            .take(input.places)
            .map(|id| account_of[id].clone())
            .collect(),
        stacks: stacks
            .iter()
            .map(|(id, s)| (account_of[id].clone(), *s))
            .collect(),
        hands: input.hands.len(),
        replay_hash: sha256_hex(input.hands.join("\n").as_bytes()),
    })
}

pub fn error_json(tournament_id: &str, error: &str) -> String {
    serde_json::to_string(&Output {
        tournament_id: tournament_id.into(),
        error: Some(error.into()),
        ..Default::default()
    })
    .unwrap()
}

pub fn run_json(raw: &str) -> String {
    match serde_json::from_str::<Input>(raw) {
        Err(e) => error_json("", &format!("INVALID_INPUT: {e}")),
        Ok(input) => match replay(&input) {
            Ok(out) => serde_json::to_string(&out).unwrap(),
            Err(e) => error_json(&input.tournament_id, &e),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(s: &str) -> Card {
        let r = "23456789TJQKA".find(&s[..1]).unwrap() as i32 + 2;
        (r, "shdc".find(&s[1..]).unwrap() as u8)
    }

    #[test]
    fn evaluates_categories() {
        let h = |x: &[&str]| evaluate_hand(&x.iter().map(|s| c(s)).collect::<Vec<_>>());
        assert_eq!(h(&["As", "Ks", "Qs", "Js", "Ts"]), vec![8, 14]);
        assert_eq!(h(&["Ah", "2s", "3d", "4c", "5h", "9s", "Kd"]), vec![4, 5]);
        assert_eq!(h(&["9h", "9s", "9d", "4c", "4h"]), vec![6, 9, 4]);
        assert!(
            compare_hands(
                &h(&["Ah", "Ad", "Kc", "Ks", "2h"]),
                &h(&["Ah", "Ad", "Qc", "Qs", "Kh"])
            ) > 0
        );
    }

    #[test]
    fn deck_is_a_permutation() {
        let d = create_deck(&"ab".repeat(32));
        let mut s = d.clone();
        s.sort();
        s.dedup();
        assert_eq!(s.len(), 52);
    }
}
