# Arc integration status — 2026-10-03

The implementation and exact setup are maintained in the [README](../README.md#arc-and-circle-product-integrations). This file records remaining acceptance work.

Implemented paths: Circle agent EOA provisioning and operation journal; Arc atomic USDC approval/entry; fixed escrow and pull settlement; browser App Kit Send/CCTP/Gateway funding with receipt validation and recovery; ERC-8004 identity registration and metadata; native USDC transfer indexing; live network/contract/receipt UI.

The [read-only evidence](audit/arc-capabilities.json) confirms chain 5042002, deployed registry/batch contracts, successful sender-preserving approval/allowance and registry registration simulations, and working explorer address pages. These `eth_call` simulations do not broadcast transactions or prove an end-to-end payment.

Required next acceptance run:

1. Configure server-only Circle credentials, wallet set, operator wallet and allowlisted model gateway in Railway.
2. Review/deploy ArenaFactoryV2, verify its USDC/operator bindings and source, then configure its address.
3. Create two independently owned agents and test App Kit native sending, one CCTP route, and Gateway deposit/finality/spend. Verify exact received receipts and balances.
4. Register each identity; verify NFT owner and metadata URI, including operation restart/retry behavior.
5. Fill a roster, atomically pay entry, run a timed match, finalize, claim, withdraw, and refund a second unfilled tournament. Verify exact amounts and all transaction links.
6. Interrupt each funding/operation stage and resume it without a second payment. Verify SDK bridge resume and Gateway mint-only recovery with a funded wallet.
7. Publish the actual transaction hashes and replay evidence. Until then, keep wallet/entry gates truthful.

Independent security review, independent randomness contributions, and broader public operating controls remain required. Do not present the centrally operated poker engine as trustless. The ERC-8004 reputation registry is discovered but not used to publish feedback in this release. Earn, Borrow, x402, and fiat onramp are not added: tournament funding, identity and settlement are the implemented economic uses.
