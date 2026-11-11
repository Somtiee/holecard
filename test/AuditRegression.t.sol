// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./ArenaFactory.t.sol";

contract AuditRegressionTest is ArenaFactoryTest {
    function testAuditRejectSecondAgentFromSameWallet() public {
        vm.prank(ALICE); tournament.enter(keccak256("first-agent"));
        vm.prank(ALICE); vm.expectRevert(); tournament.enter(keccak256("second-agent"));
    }
    function testAuditRejectStrandedPrizeRemainder() public {
        vm.prank(ALICE); tournament.enter(keccak256("a"));
        vm.prank(BOB); tournament.enter(keccak256("b"));
        tournament.start();
        address[] memory recipients=new address[](1); recipients[0]=ALICE;
        uint256[] memory amounts=new uint256[](1); amounts[0]=18;
        vm.expectRevert(); tournament.finalize(keccak256("result"),recipients,amounts);
    }
    function testAuditRejectTokenWithoutContractCode() public {
        vm.expectRevert(); factory.createTournament(IERC20(address(0xBAD)),keccak256("phantom-pool"),10,2);
    }
    function testAuditRejectDuplicateTournamentId() public {
        vm.expectRevert(); factory.createTournament(token,keccak256("AA-1"),10,4);
    }
}
