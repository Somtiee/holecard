//! Agent Arena on NEAR.
//!
//! One contract account holds:
//! - an **agent registry**: every AI agent is a sub-account `<name>.<arena>` created by this
//!   contract. The owner's wallet key is added as a full-access key; the arena server receives
//!   only a function-call key restricted to this contract and to `enter` / `withdraw`, with a
//!   capped gas allowance. Function-call keys cannot attach deposits, so the server can never move
//!   an agent's NEAR anywhere except into a tournament it was rostered for.
//! - **arena balances**: NEAR deposited for an agent (by anyone) is held here. Withdrawals always
//!   pay the agent's registered owner, whoever calls them.
//! - **tournament escrow**: entry fees, frozen prize shares, seed commitment/reveal, result and
//!   replay commitments, refunds on cancellation.
//!
//! Poker itself runs offchain and is operator asserted. The contract enforces the money rules.

use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, near, require, AccountId, Allowance, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError, PublicKey,
};
use std::num::NonZeroU128;

const MAX_SEATS: usize = 9;
const BPS_TOTAL: u32 = 10_000;
const MIN_DURATION_MS: u64 = 5 * 60 * 1000;
const MAX_DURATION_MS: u64 = 24 * 60 * 60 * 1000;
const MAX_REGISTRATION_MS: u64 = 7 * 24 * 60 * 60 * 1000;
const MIN_GRACE_MS: u64 = 10 * 60 * 1000;
const AGENT_KEY_METHODS: &str = "enter,withdraw";
const CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Agents,
    Tournaments,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum TournamentState {
    Registration,
    Running,
    Finalized,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Agent {
    pub owner: AccountId,
    pub balance: U128,
    pub created_at_ms: u64,
    pub tournaments: u32,
    pub wins: u32,
    pub winnings: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct RosterSeat {
    pub agent: AccountId,
    /// Hex sha256 of the agent's frozen strategy/model configuration.
    pub config_hash: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Payout {
    pub agent: AccountId,
    pub amount: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Tournament {
    pub id: String,
    pub rules_hash: String,
    /// sha256 over the sorted `agent|config_hash` lines, computed by the contract.
    pub roster_hash: String,
    pub seed_commitment: String,
    pub entry_fee: U128,
    pub roster: Vec<RosterSeat>,
    pub entered: Vec<AccountId>,
    pub shares: Vec<u16>,
    pub registration_deadline_ms: u64,
    pub duration_ms: u64,
    pub grace_ms: u64,
    pub state: TournamentState,
    pub started_at_ms: u64,
    pub prize_pool: U128,
    pub result_hash: Option<String>,
    pub replay_hash: Option<String>,
    pub revealed_seed: Option<String>,
    pub payouts: Vec<Payout>,
}

#[near(serializers = [json])]
pub struct ArenaConfig {
    pub operator: AccountId,
    pub agent_seed: U128,
    pub agent_gas_allowance: U128,
    pub paused: bool,
    pub agent_count: u32,
    pub tournament_count: u32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Arena {
    operator: AccountId,
    /// NEAR sent from the contract balance to each new agent account for storage and gas.
    agent_seed: NearToken,
    /// Upper bound the server's function-call key may spend on gas.
    agent_gas_allowance: NearToken,
    paused: bool,
    agents: LookupMap<AccountId, Agent>,
    agent_count: u32,
    tournaments: IterableMap<String, Tournament>,
}

fn sha256_hex(data: &[u8]) -> String {
    to_hex(&env::sha256(data))
}

fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0xf) as usize] as char);
    }
    out
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

fn is_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Roster commitment anyone can recompute: sha256 of sorted `agent|config_hash` lines joined by '\n'.
pub fn roster_hash(roster: &[RosterSeat]) -> String {
    let mut lines: Vec<String> = roster.iter().map(|s| format!("{}|{}", s.agent, s.config_hash)).collect();
    lines.sort();
    sha256_hex(lines.join("\n").as_bytes())
}

#[near]
impl Arena {
    #[init]
    pub fn new(operator: AccountId, agent_seed: U128, agent_gas_allowance: U128) -> Self {
        require!(agent_seed.0 > 0 && agent_gas_allowance.0 > 0, "ZERO_AGENT_FUNDING");
        Self {
            operator,
            agent_seed: NearToken::from_yoctonear(agent_seed.0),
            agent_gas_allowance: NearToken::from_yoctonear(agent_gas_allowance.0),
            paused: false,
            agents: LookupMap::new(StorageKey::Agents),
            agent_count: 0,
            tournaments: IterableMap::new(StorageKey::Tournaments),
        }
    }

    // ---------- admin ----------

    pub fn set_paused(&mut self, paused: bool) {
        self.assert_operator();
        self.paused = paused;
        env::log_str(&format!("EVENT_JSON:{{\"event\":\"paused\",\"value\":{paused}}}"));
    }

    // ---------- agents ----------

    /// Creates `<name>.<arena>` with the owner's full-access key and a restricted server key.
    /// Operator-only so the server can check the owner's NEP-413 sign-in first.
    pub fn create_agent(
        &mut self,
        name: String,
        owner: AccountId,
        owner_public_key: PublicKey,
        server_public_key: PublicKey,
    ) -> Promise {
        self.assert_operator();
        require!(!self.paused, "PAUSED");
        require!(
            name.len() >= 2
                && name.len() <= 32
                && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
                && !name.starts_with(['-', '_'])
                && !name.ends_with(['-', '_']),
            "INVALID_AGENT_NAME"
        );
        let agent: AccountId = format!("{name}.{}", env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str("INVALID_AGENT_ACCOUNT"));
        require!(!self.agents.contains_key(&agent), "AGENT_EXISTS");
        require!(owner_public_key != server_public_key, "SERVER_KEY_MUST_DIFFER");
        let allowance = Allowance::Limited(
            NonZeroU128::new(self.agent_gas_allowance.as_yoctonear()).expect("allowance > 0"),
        );
        Promise::new(agent.clone())
            .create_account()
            .transfer(self.agent_seed)
            .add_full_access_key(owner_public_key)
            .add_access_key_allowance(
                server_public_key,
                allowance,
                env::current_account_id(),
                AGENT_KEY_METHODS.to_string(),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_agent_created(agent, owner),
            )
    }

    #[private]
    pub fn on_agent_created(
        &mut self,
        agent: AccountId,
        owner: AccountId,
        #[callback_result] created: Result<(), PromiseError>,
    ) -> bool {
        if created.is_err() {
            env::log_str(&format!("agent account {agent} was not created"));
            return false;
        }
        self.agents.insert(
            agent.clone(),
            Agent {
                owner: owner.clone(),
                balance: U128(0),
                created_at_ms: env::block_timestamp_ms(),
                tournaments: 0,
                wins: 0,
                winnings: U128(0),
            },
        );
        self.agent_count += 1;
        env::log_str(&format!(
            "EVENT_JSON:{{\"event\":\"agent_created\",\"agent\":\"{agent}\",\"owner\":\"{owner}\"}}"
        ));
        true
    }

    /// Anyone can fund an agent's arena balance (owner wallet, a NEAR Intents payout, a sponsor).
    #[payable]
    pub fn deposit(&mut self, agent: AccountId) -> U128 {
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "ZERO_DEPOSIT");
        let mut record = self.agent(&agent);
        record.balance = U128(record.balance.0 + amount);
        self.agents.insert(agent.clone(), record.clone());
        env::log_str(&format!(
            "EVENT_JSON:{{\"event\":\"deposit\",\"agent\":\"{agent}\",\"from\":\"{}\",\"amount\":\"{amount}\"}}",
            env::predecessor_account_id()
        ));
        record.balance
    }

    /// Pays `amount` of the agent's arena balance to its owner. Callable by the owner or the agent.
    pub fn withdraw(&mut self, agent: AccountId, amount: U128) -> Promise {
        let caller = env::predecessor_account_id();
        let mut record = self.agent(&agent);
        require!(caller == record.owner || caller == agent, "NOT_OWNER_OR_AGENT");
        require!(amount.0 > 0 && amount.0 <= record.balance.0, "INSUFFICIENT_BALANCE");
        record.balance = U128(record.balance.0 - amount.0);
        let owner = record.owner.clone();
        self.agents.insert(agent.clone(), record);
        env::log_str(&format!(
            "EVENT_JSON:{{\"event\":\"withdraw\",\"agent\":\"{agent}\",\"to\":\"{owner}\",\"amount\":\"{}\"}}",
            amount.0
        ));
        Promise::new(owner).transfer(NearToken::from_yoctonear(amount.0))
    }

    // ---------- tournaments ----------

    #[allow(clippy::too_many_arguments)]
    pub fn create_tournament(
        &mut self,
        id: String,
        rules_hash: String,
        seed_commitment: String,
        entry_fee: U128,
        roster: Vec<RosterSeat>,
        shares: Vec<u16>,
        registration_ms: u64,
        duration_ms: u64,
        grace_ms: u64,
    ) -> Tournament {
        self.assert_operator();
        require!(!self.paused, "PAUSED");
        require!(!id.is_empty() && id.len() <= 64 && self.tournaments.get(&id).is_none(), "DUPLICATE_ID");
        require!(is_hash(&rules_hash) && is_hash(&seed_commitment), "INVALID_COMMITMENT");
        require!(roster.len() >= 2 && roster.len() <= MAX_SEATS, "INVALID_SEATS");
        require!(entry_fee.0 > 0, "ZERO_FEE");
        require!(registration_ms > 0 && registration_ms <= MAX_REGISTRATION_MS, "INVALID_REGISTRATION");
        require!((MIN_DURATION_MS..=MAX_DURATION_MS).contains(&duration_ms), "INVALID_DURATION");
        require!((MIN_GRACE_MS..=MAX_DURATION_MS).contains(&grace_ms), "INVALID_GRACE");
        require!(!shares.is_empty() && shares.len() <= roster.len(), "INVALID_SHARES");
        require!(shares.iter().all(|s| *s > 0), "ZERO_SHARE");
        require!(shares.iter().map(|s| *s as u32).sum::<u32>() == BPS_TOTAL, "SHARES_NOT_100_PERCENT");
        let minimum = shares.len().max(2) as u128;
        for share in &shares {
            // Every advertised place must be worth at least one yocto with the smallest playable field.
            require!(entry_fee.0 * minimum * (*share as u128) >= BPS_TOTAL as u128, "DUST_PRIZE");
        }
        let mut owners: Vec<AccountId> = Vec::new();
        for (i, seat) in roster.iter().enumerate() {
            require!(is_hash(&seat.config_hash), "INVALID_CONFIG_HASH");
            let agent = self.agent(&seat.agent);
            require!(!roster[..i].iter().any(|s| s.agent == seat.agent), "DUPLICATE_AGENT");
            require!(!owners.contains(&agent.owner), "DUPLICATE_OWNER");
            owners.push(agent.owner);
        }
        let tournament = Tournament {
            id: id.clone(),
            rules_hash,
            roster_hash: roster_hash(&roster),
            seed_commitment,
            entry_fee,
            roster,
            entered: vec![],
            shares,
            registration_deadline_ms: env::block_timestamp_ms() + registration_ms,
            duration_ms,
            grace_ms,
            state: TournamentState::Registration,
            started_at_ms: 0,
            prize_pool: U128(0),
            result_hash: None,
            replay_hash: None,
            revealed_seed: None,
            payouts: vec![],
        };
        self.tournaments.insert(id.clone(), tournament.clone());
        env::log_str(&format!(
            "EVENT_JSON:{{\"event\":\"tournament_created\",\"id\":\"{id}\",\"roster_hash\":\"{}\"}}",
            tournament.roster_hash
        ));
        tournament
    }

    /// Called by the agent account itself (the server's function-call key). The fee comes from
    /// the agent's arena balance, so no deposit is attached. A full roster starts immediately.
    pub fn enter(&mut self, tournament_id: String) -> Tournament {
        require!(!self.paused, "PAUSED");
        let agent_id = env::predecessor_account_id();
        let mut t = self.tournament(&tournament_id);
        require!(
            t.state == TournamentState::Registration && env::block_timestamp_ms() < t.registration_deadline_ms,
            "REGISTRATION_CLOSED"
        );
        require!(t.roster.iter().any(|s| s.agent == agent_id), "NOT_ON_ROSTER");
        require!(!t.entered.contains(&agent_id), "ALREADY_ENTERED");
        let mut agent = self.agent(&agent_id);
        require!(agent.balance.0 >= t.entry_fee.0, "INSUFFICIENT_BALANCE");
        agent.balance = U128(agent.balance.0 - t.entry_fee.0);
        agent.tournaments += 1;
        self.agents.insert(agent_id.clone(), agent);
        t.entered.push(agent_id.clone());
        t.prize_pool = U128(t.prize_pool.0 + t.entry_fee.0);
        env::log_str(&format!(
            "EVENT_JSON:{{\"event\":\"entered\",\"tournament\":\"{tournament_id}\",\"agent\":\"{agent_id}\",\"fee\":\"{}\"}}",
            t.entry_fee.0
        ));
        if t.entered.len() == t.roster.len() {
            Self::start_internal(&mut t);
        }
        self.tournaments.insert(tournament_id, t.clone());
        t
    }

    /// Anyone may start once registration closed with enough entrants to pay every place.
    pub fn start(&mut self, tournament_id: String) -> Tournament {
        require!(!self.paused, "PAUSED");
        let mut t = self.tournament(&tournament_id);
        require!(t.state == TournamentState::Registration, "CANNOT_START");
        require!(env::block_timestamp_ms() >= t.registration_deadline_ms, "REGISTRATION_OPEN");
        require!(t.entered.len() >= t.shares.len().max(2), "TOO_FEW_PLAYERS");
        Self::start_internal(&mut t);
        self.tournaments.insert(tournament_id, t.clone());
        t
    }

    /// Anyone may cancel an unfilled registration or an expired, unfinalized match. Entry fees are
    /// credited back to each entrant's arena balance in the same call. Works while paused.
    pub fn cancel(&mut self, tournament_id: String) -> Tournament {
        let mut t = self.tournament(&tournament_id);
        let now = env::block_timestamp_ms();
        let unfilled = t.state == TournamentState::Registration
            && now >= t.registration_deadline_ms
            && t.entered.len() < t.shares.len().max(2);
        let expired = t.state == TournamentState::Running && now > t.started_at_ms + t.duration_ms + t.grace_ms;
        require!(unfilled || expired, "CANNOT_CANCEL");
        for agent_id in t.entered.clone() {
            let mut agent = self.agent(&agent_id);
            agent.balance = U128(agent.balance.0 + t.entry_fee.0);
            self.agents.insert(agent_id, agent);
        }
        t.prize_pool = U128(0);
        t.state = TournamentState::Cancelled;
        self.tournaments.insert(tournament_id.clone(), t.clone());
        env::log_str(&format!("EVENT_JSON:{{\"event\":\"cancelled\",\"tournament\":\"{tournament_id}\"}}"));
        t
    }

    /// The operator asserts the ranking. The contract checks the seed reveal, that every ranked
    /// agent paid in, that shares are the frozen ones, and that payouts sum to the pool exactly.
    pub fn finalize(
        &mut self,
        tournament_id: String,
        result_hash: String,
        replay_hash: String,
        seed_reveal: String,
        ranking: Vec<AccountId>,
    ) -> Tournament {
        self.assert_operator();
        require!(!self.paused, "PAUSED");
        let mut t = self.tournament(&tournament_id);
        require!(
            t.state == TournamentState::Running
                && env::block_timestamp_ms() <= t.started_at_ms + t.duration_ms + t.grace_ms,
            "CANNOT_FINALIZE"
        );
        require!(is_hash(&result_hash) && is_hash(&replay_hash), "INVALID_EVIDENCE");
        let seed = from_hex(&seed_reveal).unwrap_or_else(|| env::panic_str("INVALID_SEED"));
        require!(sha256_hex(&seed) == t.seed_commitment, "SEED_MISMATCH");
        require!(ranking.len() == t.shares.len(), "INVALID_RANKING");
        let pool = t.prize_pool.0;
        let mut allocated: u128 = 0;
        let mut payouts = Vec::with_capacity(ranking.len());
        for (i, agent_id) in ranking.iter().enumerate() {
            require!(t.entered.contains(agent_id), "NOT_ENTRANT");
            require!(!ranking[..i].contains(agent_id), "DUPLICATE_RANK");
            let share = if i == ranking.len() - 1 {
                pool - allocated
            } else {
                pool * t.shares[i] as u128 / BPS_TOTAL as u128
            };
            require!(share > 0, "DUST_PRIZE");
            allocated += share;
            let mut agent = self.agent(agent_id);
            agent.balance = U128(agent.balance.0 + share);
            agent.winnings = U128(agent.winnings.0 + share);
            if i == 0 {
                agent.wins += 1;
            }
            self.agents.insert(agent_id.clone(), agent);
            payouts.push(Payout { agent: agent_id.clone(), amount: U128(share) });
        }
        require!(allocated == pool, "ACCOUNTING_ERROR");
        t.prize_pool = U128(0);
        t.result_hash = Some(result_hash);
        t.replay_hash = Some(replay_hash);
        t.revealed_seed = Some(to_hex(&seed));
        t.payouts = payouts;
        t.state = TournamentState::Finalized;
        self.tournaments.insert(tournament_id.clone(), t.clone());
        env::log_str(&format!("EVENT_JSON:{{\"event\":\"finalized\",\"tournament\":\"{tournament_id}\"}}"));
        t
    }

    // ---------- views ----------

    pub fn get_config(&self) -> ArenaConfig {
        ArenaConfig {
            operator: self.operator.clone(),
            agent_seed: U128(self.agent_seed.as_yoctonear()),
            agent_gas_allowance: U128(self.agent_gas_allowance.as_yoctonear()),
            paused: self.paused,
            agent_count: self.agent_count,
            tournament_count: self.tournaments.len(),
        }
    }

    pub fn get_agent(&self, agent: AccountId) -> Option<Agent> {
        self.agents.get(&agent).cloned()
    }

    pub fn get_tournament(&self, id: String) -> Option<Tournament> {
        self.tournaments.get(&id).cloned()
    }

    pub fn get_tournaments(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Tournament> {
        self.tournaments
            .values()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .cloned()
            .collect()
    }

    // ---------- internals ----------

    fn start_internal(t: &mut Tournament) {
        t.state = TournamentState::Running;
        t.started_at_ms = env::block_timestamp_ms();
        env::log_str(&format!(
            "EVENT_JSON:{{\"event\":\"started\",\"tournament\":\"{}\",\"ends_at_ms\":{}}}",
            t.id,
            t.started_at_ms + t.duration_ms
        ));
    }

    fn assert_operator(&self) {
        require!(env::predecessor_account_id() == self.operator, "NOT_OPERATOR");
    }

    fn agent(&self, id: &AccountId) -> Agent {
        self.agents.get(id).cloned().unwrap_or_else(|| env::panic_str("UNKNOWN_AGENT"))
    }

    fn tournament(&self, id: &String) -> Tournament {
        self.tournaments.get(id).cloned().unwrap_or_else(|| env::panic_str("UNKNOWN_TOURNAMENT"))
    }
}

#[cfg(test)]
mod tests;
