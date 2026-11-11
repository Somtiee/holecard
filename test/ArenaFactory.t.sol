// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../contracts/ArenaFactory.sol";

interface Vm { function prank(address) external; function expectRevert() external; function expectRevert(bytes calldata) external; }

contract MockUSDC is IERC20 {
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    function mint(address to,uint256 amount) external {balanceOf[to]+=amount;}
    function approve(address spender,uint256 amount) external returns(bool){allowance[msg.sender][spender]=amount;return true;}
    function transfer(address to,uint256 amount) external returns(bool){require(balanceOf[msg.sender]>=amount,"BALANCE");balanceOf[msg.sender]-=amount;balanceOf[to]+=amount;return true;}
    function transferFrom(address from,address to,uint256 amount) external returns(bool){require(balanceOf[from]>=amount&&allowance[from][msg.sender]>=amount,"ALLOWANCE");allowance[from][msg.sender]-=amount;balanceOf[from]-=amount;balanceOf[to]+=amount;return true;}
}

contract ArenaFactoryTest {
    Vm constant vm=Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant OPERATOR=address(0xA11CE);
    address constant ALICE=address(0xA1);
    address constant BOB=address(0xB0B);
    MockUSDC token;
    ArenaFactory factory;
    ArenaTournament tournament;
    function setUp() public {token=new MockUSDC();factory=new ArenaFactory();address addr=factory.createTournament(token,keccak256("AA-1"),10,4);tournament=ArenaTournament(addr);token.mint(ALICE,50);token.mint(BOB,50);vm.prank(ALICE);token.approve(addr,50);vm.prank(BOB);token.approve(addr,50);}
    function testEntryAndDuplicatePrevention() public {vm.prank(ALICE);tournament.enter(keccak256("agent-alice"));require(tournament.playerCount()==1&&tournament.prizePool()==10,"entry accounting");vm.prank(ALICE);vm.expectRevert();tournament.enter(keccak256("agent-alice"));}
    function testSettlementPaysEntirePoolWithZeroPlatformFee() public {vm.prank(ALICE);tournament.enter(keccak256("agent-alice"));vm.prank(BOB);tournament.enter(keccak256("agent-bob"));tournament.start();address[] memory winners=new address[](1);winners[0]=ALICE;uint256[] memory payout=new uint256[](1);payout[0]=20;tournament.finalize(keccak256("result"),winners,payout);require(token.balanceOf(ALICE)==60,"winner paid");require(tournament.prizePool()==0,"pool fully distributed");require(uint8(tournament.state())==2,"final state");}
    function testOverpaymentRevertsAtomically() public {vm.prank(ALICE);tournament.enter(keccak256("agent-alice"));vm.prank(BOB);tournament.enter(keccak256("agent-bob"));tournament.start();address[] memory winners=new address[](1);winners[0]=ALICE;uint256[] memory payout=new uint256[](1);payout[0]=21;vm.expectRevert();tournament.finalize(keccak256("result"),winners,payout);require(uint8(tournament.state())==1,"state rolled back");}
    function testDuplicateRecipientReverts() public {vm.prank(ALICE);tournament.enter(keccak256("agent-alice"));vm.prank(BOB);tournament.enter(keccak256("agent-bob"));tournament.start();address[] memory winners=new address[](2);winners[0]=ALICE;winners[1]=ALICE;uint256[] memory payouts=new uint256[](2);payouts[0]=5;payouts[1]=5;vm.expectRevert();tournament.finalize(keccak256("result"),winners,payouts);}
    function testOnlyRegisteredPlayerCanBePaid() public {vm.prank(ALICE);tournament.enter(keccak256("agent-alice"));vm.prank(BOB);tournament.enter(keccak256("agent-bob"));tournament.start();address[] memory winners=new address[](1);winners[0]=address(0xBAD);uint256[] memory payout=new uint256[](1);payout[0]=1;vm.expectRevert();tournament.finalize(keccak256("result"),winners,payout);}
    function testCancelledEntriesCanRefundOnce() public {vm.prank(ALICE);tournament.enter(keccak256("agent-alice"));tournament.cancel();vm.prank(ALICE);tournament.refund();require(token.balanceOf(ALICE)==50&&tournament.prizePool()==0,"refund accounting");vm.prank(ALICE);vm.expectRevert();tournament.refund();}
    function testPauseBlocksEntry() public {tournament.setPaused(true);vm.prank(ALICE);vm.expectRevert();tournament.enter(keccak256("agent-alice"));}
    function testOnlyOperatorCanFinalize() public {vm.prank(ALICE);tournament.enter(keccak256("agent-alice"));vm.prank(BOB);tournament.enter(keccak256("agent-bob"));tournament.start();address[] memory winners=new address[](1);winners[0]=ALICE;uint256[] memory payout=new uint256[](1);payout[0]=20;vm.prank(ALICE);vm.expectRevert();tournament.finalize(keccak256("result"),winners,payout);}
    function testFactoryPauseBlocksCreationAndUnauthorizedPause() public {factory.setPaused(true);vm.expectRevert();factory.createTournament(token,keccak256("AA-2"),10,2);vm.prank(ALICE);vm.expectRevert();factory.setPaused(false);}
}
