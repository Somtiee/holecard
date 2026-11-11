// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../contracts/ArenaV2.sol";
import "./ArenaFactory.t.sol";

interface VmV2 { function prank(address) external; function expectRevert() external; function warp(uint256) external; }

contract RejectingUSDC is IArenaUSDC {
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    address public blocked;
    function mint(address to,uint256 amount) external { balanceOf[to]+=amount; }
    function setBlocked(address to) external { blocked=to; }
    function approve(address spender,uint256 amount) external returns(bool){allowance[msg.sender][spender]=amount;return true;}
    function transfer(address to,uint256 amount) external returns(bool){require(to!=blocked,"BLOCKED");require(balanceOf[msg.sender]>=amount,"BALANCE");balanceOf[msg.sender]-=amount;balanceOf[to]+=amount;return true;}
    function transferFrom(address from,address to,uint256 amount) external returns(bool){require(balanceOf[from]>=amount&&allowance[from][msg.sender]>=amount,"ALLOWANCE");allowance[from][msg.sender]-=amount;balanceOf[from]-=amount;balanceOf[to]+=amount;return true;}
}

contract ArenaV2Test {
    VmV2 constant vm=VmV2(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant ALICE=address(0xA1);
    address constant BOB=address(0xB0B);
    bytes32 constant ALICE_ID=keccak256("agent-alice");
    bytes32 constant BOB_ID=keccak256("agent-bob");
    bytes32 constant ALICE_CONFIG=keccak256("alice-config");
    bytes32 constant BOB_CONFIG=keccak256("bob-config");
    bytes32 constant SEED=bytes32(uint256(0x123456));
    MockUSDC token;
    ArenaFactoryV2 factory;
    ArenaTournamentV2 tournament;
    bytes32 aliceLeaf;
    bytes32 bobLeaf;

    function setUp() public {
        token=new MockUSDC();
        factory=new ArenaFactoryV2(IArenaUSDC(address(token)),address(this));
        aliceLeaf=keccak256(abi.encode(ALICE_ID,ALICE,ALICE_CONFIG));
        bobLeaf=keccak256(abi.encode(BOB_ID,BOB,BOB_CONFIG));
        bytes32 root=aliceLeaf<bobLeaf?keccak256(abi.encodePacked(aliceLeaf,bobLeaf)):keccak256(abi.encodePacked(bobLeaf,aliceLeaf));
        uint16[] memory shares=new uint16[](2);shares[0]=7000;shares[1]=3000;
        address deployed=factory.createTournament(keccak256("AA-V2-1"),keccak256("rules"),root,keccak256(abi.encodePacked(SEED)),10,2,block.timestamp+1 hours,5 minutes,10 minutes,shares);
        tournament=ArenaTournamentV2(deployed);
        token.mint(ALICE,50);token.mint(BOB,50);
        vm.prank(ALICE);token.approve(deployed,50);
        vm.prank(BOB);token.approve(deployed,50);
    }
    function aliceProof() internal view returns(bytes32[] memory p){p=new bytes32[](1);p[0]=bobLeaf;}
    function bobProof() internal view returns(bytes32[] memory p){p=new bytes32[](1);p[0]=aliceLeaf;}
    function enterBoth() internal {vm.prank(ALICE);tournament.enter(ALICE_ID,ALICE_CONFIG,aliceProof());vm.prank(BOB);tournament.enter(BOB_ID,BOB_CONFIG,bobProof());}
    function finish() internal {enterBoth();tournament.start();address[] memory ranking=new address[](2);ranking[0]=ALICE;ranking[1]=BOB;tournament.finalize(keccak256("result"),keccak256("replay"),SEED,ranking);}

    function testRosterBindsWalletAndConfig() public {vm.prank(BOB);vm.expectRevert();tournament.enter(ALICE_ID,ALICE_CONFIG,aliceProof());vm.prank(ALICE);vm.expectRevert();tournament.enter(ALICE_ID,BOB_CONFIG,aliceProof());vm.prank(ALICE);tournament.enter(ALICE_ID,ALICE_CONFIG,aliceProof());require(tournament.prizePool()==10,"escrow");vm.prank(ALICE);vm.expectRevert();tournament.enter(ALICE_ID,ALICE_CONFIG,aliceProof());}
    function testFixedSharesAndPullClaims() public {finish();require(tournament.claimable(ALICE)==14&&tournament.claimable(BOB)==6,"shares");vm.prank(BOB);tournament.claim();vm.prank(ALICE);tournament.claim();require(token.balanceOf(ALICE)==54&&token.balanceOf(BOB)==46,"winnings");require(tournament.prizePool()==0,"pool");vm.prank(ALICE);vm.expectRevert();tournament.claim();}
    function testOnlyOperatorAndMatchingSeedCanFinalize() public {enterBoth();tournament.start();address[] memory ranking=new address[](2);ranking[0]=ALICE;ranking[1]=BOB;vm.prank(ALICE);vm.expectRevert();tournament.finalize(keccak256("result"),keccak256("replay"),SEED,ranking);vm.expectRevert();tournament.finalize(keccak256("result"),keccak256("replay"),bytes32(uint256(99)),ranking);require(uint8(tournament.state())==1,"running");}
    function testDuplicateRankingCannotAllocateTwice() public {enterBoth();tournament.start();address[] memory ranking=new address[](2);ranking[0]=ALICE;ranking[1]=ALICE;vm.expectRevert();tournament.finalize(keccak256("result"),keccak256("replay"),SEED,ranking);}
    function testUnfilledTournamentRefundsAfterDeadline() public {vm.prank(ALICE);tournament.enter(ALICE_ID,ALICE_CONFIG,aliceProof());vm.warp(block.timestamp+1 hours);tournament.cancelIfUnfilled();vm.prank(ALICE);tournament.refund();require(token.balanceOf(ALICE)==50,"refunded");vm.prank(ALICE);vm.expectRevert();tournament.refund();}
    function testExpiredRunningTournamentRefunds() public {enterBoth();tournament.start();vm.warp(block.timestamp+15 minutes+1);tournament.cancelExpired();vm.prank(ALICE);tournament.refund();vm.prank(BOB);tournament.refund();require(token.balanceOf(ALICE)==50&&token.balanceOf(BOB)==50,"refunded");}
    function testPauseDoesNotBlockClaims() public {finish();tournament.setPaused(true);vm.prank(ALICE);tournament.claim();require(token.balanceOf(ALICE)==54,"claim during pause");}
    function testOneBlockedRecipientDoesNotBlockOtherClaim() public {
        RejectingUSDC failing=new RejectingUSDC();
        ArenaFactoryV2 otherFactory=new ArenaFactoryV2(failing,address(this));
        uint16[] memory shares=new uint16[](2);shares[0]=7000;shares[1]=3000;
        bytes32 root=aliceLeaf<bobLeaf?keccak256(abi.encodePacked(aliceLeaf,bobLeaf)):keccak256(abi.encodePacked(bobLeaf,aliceLeaf));
        ArenaTournamentV2 other=ArenaTournamentV2(otherFactory.createTournament(keccak256("AA-V2-BLOCK"),keccak256("rules"),root,keccak256(abi.encodePacked(SEED)),10,2,block.timestamp+1 hours,5 minutes,10 minutes,shares));
        failing.mint(ALICE,50);failing.mint(BOB,50);
        vm.prank(ALICE);failing.approve(address(other),10);
        vm.prank(BOB);failing.approve(address(other),10);
        vm.prank(ALICE);other.enter(ALICE_ID,ALICE_CONFIG,aliceProof());
        vm.prank(BOB);other.enter(BOB_ID,BOB_CONFIG,bobProof());
        other.start();address[] memory ranking=new address[](2);ranking[0]=ALICE;ranking[1]=BOB;
        other.finalize(keccak256("result"),keccak256("replay"),SEED,ranking);
        failing.setBlocked(ALICE);
        vm.prank(ALICE);vm.expectRevert();other.claim();
        vm.prank(BOB);other.claim();
        require(failing.balanceOf(BOB)==46&&other.claimable(ALICE)==14,"independent claim");
    }
    function testTooFewEntrantsForPayoutPlacesCanRefund() public {
        uint16[] memory shares=new uint16[](3);shares[0]=5000;shares[1]=3000;shares[2]=2000;
        bytes32 root=aliceLeaf<bobLeaf?keccak256(abi.encodePacked(aliceLeaf,bobLeaf)):keccak256(abi.encodePacked(bobLeaf,aliceLeaf));
        ArenaTournamentV2 three=ArenaTournamentV2(factory.createTournament(keccak256("THREE-PLACES"),keccak256("rules"),root,keccak256(abi.encodePacked(SEED)),10,3,block.timestamp+1 hours,5 minutes,10 minutes,shares));
        vm.prank(ALICE);token.approve(address(three),10);
        vm.prank(BOB);token.approve(address(three),10);
        vm.prank(ALICE);three.enter(ALICE_ID,ALICE_CONFIG,aliceProof());
        vm.prank(BOB);three.enter(BOB_ID,BOB_CONFIG,bobProof());
        vm.warp(block.timestamp+1 hours);
        vm.expectRevert();three.start();
        three.cancelIfUnfilled();
        vm.prank(ALICE);three.refund();
        vm.prank(BOB);three.refund();
        require(token.balanceOf(ALICE)==50&&token.balanceOf(BOB)==50,"both refunded");
    }
    function testRejectDustPrizeAtCreation() public {
        uint16[] memory shares=new uint16[](2);shares[0]=9999;shares[1]=1;
        bytes32 root=aliceLeaf<bobLeaf?keccak256(abi.encodePacked(aliceLeaf,bobLeaf)):keccak256(abi.encodePacked(bobLeaf,aliceLeaf));
        vm.expectRevert();
        factory.createTournament(keccak256("DUST-PRIZE"),keccak256("rules"),root,keccak256(abi.encodePacked(SEED)),1,2,block.timestamp+1 hours,5 minutes,10 minutes,shares);
    }
}
