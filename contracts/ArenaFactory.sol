// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 { function transfer(address to,uint256 value) external returns(bool); function transferFrom(address from,address to,uint256 value) external returns(bool); function balanceOf(address owner) external view returns(uint256); }

contract ArenaTournament {
    enum State { Registration, Running, Finalized, Cancelled }
    IERC20 public immutable usdc;
    address public immutable factory;
    address public immutable operator;
    uint256 public immutable entryFee;
    uint256 public immutable capacity;
    bytes32 public immutable tournamentId;
    State public state;
    address[] public agents;
    mapping(bytes32=>bool) public registered;
    mapping(address=>bool) public paid;
    uint256 public prizePool;
    bool private locked;
    bool public paused;
    event AgentRegistered(bytes32 indexed agentId,address indexed wallet,uint256 entryFee);
    event TournamentStarted(bytes32 indexed tournamentId);
    event TournamentFinalized(bytes32 indexed tournamentId,bytes32 resultCommitment);
    event PrizePaid(bytes32 indexed tournamentId,address indexed recipient,uint256 amount);
    modifier nonReentrant(){require(!locked,"REENTRANT");locked=true;_;locked=false;}
    modifier onlyOperator(){require(msg.sender==operator,"NOT_OPERATOR");_;}
    constructor(IERC20 token,address admin,bytes32 id,uint256 fee,uint256 maxAgents){require(address(token)!=address(0)&&admin!=address(0)&&id!=bytes32(0)&&maxAgents>1&&maxAgents<=256,"INVALID_CONFIG");usdc=token;factory=msg.sender;operator=admin;tournamentId=id;entryFee=fee;capacity=maxAgents;state=State.Registration;_tokenBalance();}
    function enter(bytes32 agentId) external nonReentrant {require(!paused,"PAUSED");require(state==State.Registration,"NOT_REGISTERING");require(agentId!=bytes32(0)&&!registered[agentId],"DUPLICATE_AGENT");require(!paid[msg.sender],"DUPLICATE_WALLET");require(agents.length<capacity,"FULL");registered[agentId]=true;paid[msg.sender]=true;agents.push(msg.sender);uint256 beforeBalance=_tokenBalance();_safeTransferFrom(msg.sender,address(this),entryFee);require(_tokenBalance()==beforeBalance+entryFee,"ENTRY_AMOUNT_MISMATCH");prizePool+=entryFee;emit AgentRegistered(agentId,msg.sender,entryFee);}
    function start() external onlyOperator {require(!paused,"PAUSED");require(state==State.Registration&&agents.length>=2,"CANNOT_START");state=State.Running;emit TournamentStarted(tournamentId);}
    function setPaused(bool value) external onlyOperator {paused=value;}
    function cancel() external onlyOperator {require(state==State.Registration,"CANNOT_CANCEL");state=State.Cancelled;}
    function refund() external nonReentrant {require(state==State.Cancelled&&paid[msg.sender],"NO_REFUND");paid[msg.sender]=false;_safeTransfer(msg.sender,entryFee);prizePool-=entryFee;}
    function finalize(bytes32 resultCommitment,address[] calldata recipients,uint256[] calldata payouts) external onlyOperator nonReentrant {require(!paused,"PAUSED");require(state==State.Running&&resultCommitment!=bytes32(0)&&recipients.length>0&&recipients.length<=agents.length&&recipients.length==payouts.length,"INVALID_RESULT");state=State.Finalized;uint256 total;for(uint256 i;i<payouts.length;i++){require(paid[recipients[i]],"NOT_A_PLAYER");for(uint256 j;j<i;j++){require(recipients[j]!=recipients[i],"DUPLICATE_RECIPIENT");}total+=payouts[i];}require(total==prizePool,"INCOMPLETE_PAYOUT");emit TournamentFinalized(tournamentId,resultCommitment);prizePool=0;for(uint256 i;i<payouts.length;i++){_safeTransfer(recipients[i],payouts[i]);emit PrizePaid(tournamentId,recipients[i],payouts[i]);}}
    // Validate return data, rather than EXTCODESIZE: native token interfaces may be precompiles.
    function _tokenBalance() private view returns(uint256) {(bool ok,bytes memory data)=address(usdc).staticcall(abi.encodeWithSelector(IERC20.balanceOf.selector,address(this)));require(ok&&data.length==32,"INVALID_TOKEN");return abi.decode(data,(uint256));}
    function _safeTransfer(address to,uint256 amount) private { (bool ok,bytes memory data)=address(usdc).call(abi.encodeWithSelector(IERC20.transfer.selector,to,amount)); require(ok&&(data.length==0||abi.decode(data,(bool))),"TRANSFER_FAILED"); }
    function _safeTransferFrom(address from,address to,uint256 amount) private { (bool ok,bytes memory data)=address(usdc).call(abi.encodeWithSelector(IERC20.transferFrom.selector,from,to,amount)); require(ok&&(data.length==0||abi.decode(data,(bool))),"TRANSFER_FROM_FAILED"); }
    function playerCount() external view returns(uint256){return agents.length;}
}

contract ArenaFactory {
    address public immutable operator;
    bool public paused;
    address[] public tournaments;
    mapping(bytes32=>address) public tournamentById;
    event TournamentCreated(bytes32 indexed tournamentId,address indexed tournament,address token,uint256 entryFee,uint256 capacity);
    event Paused(bool paused);
    modifier onlyOperator(){require(msg.sender==operator,"NOT_OPERATOR");_;}
    constructor(){operator=msg.sender;}
    function setPaused(bool value) external onlyOperator {paused=value;emit Paused(value);}
    function createTournament(IERC20 token,bytes32 id,uint256 entryFee,uint256 capacity) external onlyOperator returns(address tournament){require(!paused,"PAUSED");require(tournamentById[id]==address(0),"DUPLICATE_TOURNAMENT");tournament=address(new ArenaTournament(token,operator,id,entryFee,capacity));tournamentById[id]=tournament;tournaments.push(tournament);emit TournamentCreated(id,tournament,address(token),entryFee,capacity);}
    function tournamentCount() external view returns(uint256){return tournaments.length;}
}
