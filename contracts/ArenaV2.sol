// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IArenaUSDC {
    function balanceOf(address owner) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Escrows testnet USDC and commits match evidence. Poker and ranking remain operator asserted.
contract ArenaTournamentV2 {
    enum State { Registration, Running, Finalized, Cancelled }

    IArenaUSDC public immutable usdc;
    address public immutable operator;
    bytes32 public immutable tournamentId;
    bytes32 public immutable rulesHash;
    bytes32 public immutable rosterRoot;
    bytes32 public immutable seedCommitment;
    uint256 public immutable entryFee;
    uint256 public immutable capacity;
    uint256 public immutable registrationDeadline;
    uint256 public immutable durationSeconds;
    uint256 public immutable graceSeconds;
    uint16[] public prizeBps;
    State public state;
    uint256 public startedAt;
    uint256 public prizePool;
    bytes32 public resultRoot;
    bytes32 public replayHash;
    bytes32 public revealedSeed;
    bool public paused;
    bool private locked;
    address[] public players;
    mapping(bytes32 => address) public agentWallet;
    mapping(address => bool) public entered;
    mapping(address => uint256) public claimable;

    event AgentRegistered(bytes32 indexed tournamentId, bytes32 indexed agentId, address indexed wallet, bytes32 configHash, uint256 fee);
    event TournamentStarted(bytes32 indexed tournamentId, uint256 startedAt, uint256 endsAt);
    event TournamentFinalized(bytes32 indexed tournamentId, bytes32 resultRoot, bytes32 replayHash, bytes32 seedReveal);
    event PrizePaid(bytes32 indexed tournamentId, address indexed wallet, uint256 amount);
    event TournamentCancelled(bytes32 indexed tournamentId);
    event EntryRefunded(bytes32 indexed tournamentId, address indexed wallet, uint256 amount);
    event Paused(bool value);

    modifier onlyOperator() { require(msg.sender == operator, "NOT_OPERATOR"); _; }
    modifier nonReentrant() { require(!locked, "REENTRANT"); locked = true; _; locked = false; }

    constructor(
        IArenaUSDC token, address admin, bytes32 id, bytes32 rules, bytes32 roster, bytes32 seed,
        uint256 fee, uint256 seats, uint256 closesAt, uint256 duration, uint256 grace, uint16[] memory shares
    ) {
        require(address(token) != address(0) && admin != address(0), "ZERO_ADDRESS");
        require(id != 0 && rules != 0 && roster != 0 && seed != 0, "ZERO_COMMITMENT");
        require(seats >= 2 && seats <= 9 && fee > 0, "INVALID_SEATS_OR_FEE");
        require(closesAt > block.timestamp && closesAt <= block.timestamp + 7 days, "INVALID_CLOSE");
        require(duration >= 5 minutes && duration <= 1 days && grace >= 10 minutes && grace <= 1 days, "INVALID_TIME");
        require(shares.length > 0 && shares.length <= seats, "INVALID_SHARES");
        uint256 total;
        uint256 minimumEntrants = shares.length > 2 ? shares.length : 2;
        for (uint256 i; i < shares.length; i++) {
            require(shares[i] > 0, "ZERO_SHARE");
            // Each advertised place must receive at least one USDC base unit,
            // even when registration closes with the minimum playable field.
            uint256 denominator = minimumEntrants * uint256(shares[i]);
            require(fee >= (10_000 + denominator - 1) / denominator, "DUST_PRIZE");
            total += shares[i];
        }
        require(total == 10_000, "SHARES_NOT_100_PERCENT");
        usdc = token; operator = admin; tournamentId = id; rulesHash = rules; rosterRoot = roster;
        seedCommitment = seed; entryFee = fee; capacity = seats; registrationDeadline = closesAt;
        durationSeconds = duration; graceSeconds = grace; prizeBps = shares;
        _balance();
    }

    function playerCount() external view returns (uint256) { return players.length; }
    function prizeCount() external view returns (uint256) { return prizeBps.length; }
    function finalizationDeadline() public view returns (uint256) {
        return startedAt == 0 ? 0 : startedAt + durationSeconds + graceSeconds;
    }
    function setPaused(bool value) external onlyOperator { paused = value; emit Paused(value); }

    /// @dev Leaf = keccak256(abi.encode(agentId, wallet, configHash)); pairs are sorted before hashing.
    function enter(bytes32 agentId, bytes32 configHash, bytes32[] calldata proof) external nonReentrant {
        require(!paused && state == State.Registration && block.timestamp < registrationDeadline, "REGISTRATION_CLOSED");
        require(players.length < capacity, "FULL");
        require(agentId != 0 && configHash != 0 && !entered[msg.sender] && agentWallet[agentId] == address(0), "DUPLICATE");
        bytes32 node = keccak256(abi.encode(agentId, msg.sender, configHash));
        for (uint256 i; i < proof.length; i++) {
            bytes32 sibling = proof[i];
            node = node < sibling ? keccak256(abi.encodePacked(node, sibling)) : keccak256(abi.encodePacked(sibling, node));
        }
        require(node == rosterRoot, "NOT_ON_ROSTER");
        entered[msg.sender] = true; agentWallet[agentId] = msg.sender; players.push(msg.sender);
        uint256 beforeBalance = _balance();
        _transferFrom(msg.sender, address(this), entryFee);
        require(_balance() == beforeBalance + entryFee, "ENTRY_AMOUNT_MISMATCH");
        prizePool += entryFee;
        emit AgentRegistered(tournamentId, agentId, msg.sender, configHash, entryFee);
    }

    /// @notice Anyone may start when full, or after registration closes with at least two entrants.
    function start() external {
        require(!paused && state == State.Registration, "CANNOT_START");
        require(players.length >= 2 && players.length >= prizeBps.length, "TOO_FEW_PLAYERS");
        require(players.length == capacity || block.timestamp >= registrationDeadline, "REGISTRATION_OPEN");
        state = State.Running; startedAt = block.timestamp;
        emit TournamentStarted(tournamentId, startedAt, startedAt + durationSeconds);
    }

    /// @notice Refunds remain available even while paused, so an incident cannot freeze recovery.
    function cancelIfUnfilled() external {
        require(state == State.Registration && block.timestamp >= registrationDeadline && (players.length < 2 || players.length < prizeBps.length), "CANNOT_CANCEL");
        state = State.Cancelled; emit TournamentCancelled(tournamentId);
    }
    function cancelExpired() external {
        require(state == State.Running && block.timestamp > finalizationDeadline(), "NOT_EXPIRED");
        state = State.Cancelled; emit TournamentCancelled(tournamentId);
    }
    function refund() external nonReentrant {
        require(state == State.Cancelled && entered[msg.sender], "NO_REFUND");
        entered[msg.sender] = false; prizePool -= entryFee;
        _transfer(msg.sender, entryFee);
        emit EntryRefunded(tournamentId, msg.sender, entryFee);
    }

    /// @notice The operator asserts rankings; the contract enforces frozen shares, entrants, seed reveal and exact accounting.
    function finalize(bytes32 result, bytes32 replay, bytes32 seedReveal, address[] calldata ranking) external onlyOperator nonReentrant {
        require(!paused && state == State.Running && block.timestamp <= finalizationDeadline(), "CANNOT_FINALIZE");
        require(result != 0 && replay != 0 && keccak256(abi.encodePacked(seedReveal)) == seedCommitment, "INVALID_EVIDENCE");
        require(ranking.length == prizeBps.length, "INVALID_RANKING");
        uint256 allocated;
        for (uint256 i; i < ranking.length; i++) {
            require(entered[ranking[i]], "NOT_ENTRANT");
            for (uint256 j; j < i; j++) require(ranking[i] != ranking[j], "DUPLICATE_RANK");
            uint256 share = i == ranking.length - 1 ? prizePool - allocated : prizePool * prizeBps[i] / 10_000;
            require(share > 0, "DUST_PRIZE");
            claimable[ranking[i]] = share; allocated += share;
        }
        require(allocated == prizePool, "ACCOUNTING_ERROR");
        resultRoot = result; replayHash = replay; revealedSeed = seedReveal; state = State.Finalized;
        emit TournamentFinalized(tournamentId, result, replay, seedReveal);
    }

    function claim() external nonReentrant {
        require(state == State.Finalized, "NOT_FINALIZED");
        uint256 amount = claimable[msg.sender];
        require(amount > 0, "NOTHING_TO_CLAIM");
        claimable[msg.sender] = 0; prizePool -= amount;
        _transfer(msg.sender, amount);
        emit PrizePaid(tournamentId, msg.sender, amount);
    }

    function _balance() private view returns (uint256) {
        (bool ok, bytes memory data) = address(usdc).staticcall(abi.encodeWithSelector(IArenaUSDC.balanceOf.selector, address(this)));
        require(ok && data.length == 32, "INVALID_TOKEN");
        return abi.decode(data, (uint256));
    }
    function _transfer(address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(usdc).call(abi.encodeWithSelector(IArenaUSDC.transfer.selector, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FAILED");
    }
    function _transferFrom(address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(usdc).call(abi.encodeWithSelector(IArenaUSDC.transferFrom.selector, from, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FROM_FAILED");
    }
}

contract ArenaFactoryV2 {
    IArenaUSDC public immutable usdc;
    address public immutable operator;
    bool public paused;
    mapping(bytes32 => address) public tournamentById;
    address[] public tournaments;
    event TournamentCreated(bytes32 indexed tournamentId, address indexed tournament, bytes32 rulesHash, bytes32 rosterRoot, bytes32 seedCommitment, uint256 entryFee, uint256 capacity);
    event Paused(bool value);
    modifier onlyOperator() { require(msg.sender == operator, "NOT_OPERATOR"); _; }
    constructor(IArenaUSDC token, address admin) {
        require(address(token) != address(0) && admin != address(0), "ZERO_ADDRESS");
        usdc = token; operator = admin;
        (bool ok, bytes memory data) = address(token).staticcall(abi.encodeWithSelector(IArenaUSDC.balanceOf.selector, address(this)));
        require(ok && data.length == 32, "INVALID_TOKEN");
    }
    function tournamentCount() external view returns (uint256) { return tournaments.length; }
    function setPaused(bool value) external onlyOperator { paused = value; emit Paused(value); }
    function createTournament(
        bytes32 id, bytes32 rulesHash, bytes32 rosterRoot, bytes32 seedCommitment,
        uint256 entryFee, uint256 capacity, uint256 closesAt, uint256 duration, uint256 grace, uint16[] calldata shares
    ) external onlyOperator returns (address tournament) {
        require(!paused && id != 0 && tournamentById[id] == address(0), "DUPLICATE_OR_PAUSED");
        tournament = address(new ArenaTournamentV2(usdc, operator, id, rulesHash, rosterRoot, seedCommitment,
            entryFee, capacity, closesAt, duration, grace, shares));
        tournamentById[id] = tournament; tournaments.push(tournament);
        emit TournamentCreated(id, tournament, rulesHash, rosterRoot, seedCommitment, entryFee, capacity);
    }
}
