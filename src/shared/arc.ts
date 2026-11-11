/** Arc Testnet deployments from the official Arc contract-address reference. */
export const ARC_CHAIN_ID=5042002;
export const ARC_EXPLORER='https://explorer.testnet.arc.io';
export const ARC_USDC='0x3600000000000000000000000000000000000000' as const;
export const ARC_SYSTEM_USDC='0xfffffffffffffffffffffffffffffffffffffffe' as const;
export const ARC_MULTICALL_FROM='0x522fAf9A91c41c443c66765030741e4AaCe147D0' as const;
export const ARC_IDENTITY_REGISTRY='0x8004A818BFB912233c491871b3d84c89A494BD9e' as const;
export const ARC_REPUTATION_REGISTRY='0x8004B663056A597Dffe9eCcC1965A193B7388713' as const;
export const FUNDING_CHAINS=['Arc_Testnet','Base_Sepolia','Ethereum_Sepolia','Arbitrum_Sepolia'] as const;
export type FundingChain=typeof FUNDING_CHAINS[number];
export const chainLabel=(chain:string)=>chain.replaceAll('_',' ');
export const arcTransactionUrl=(hash:string)=>/^0x[\da-f]{64}$/i.test(hash)?`${ARC_EXPLORER}/tx/${hash}`:null;
