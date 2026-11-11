import { validateAction, type Player } from '../engine/poker';

/** Legacy model adapter used by primitive tests. The live runner uses src/server/provider.ts. */
export type AgentContext = {
  position: string;
  holeCards: string[];
  communityCards: string[];
  pot: number;
  stack: number;
  opponents: { stack: number; folded: boolean }[];
  legalActions: { action: string; min?: number; max?: number }[];
};
export type AgentResponse = { action: 'fold' | 'check' | 'call' | 'raise' | 'all-in'; amount?: number };
export interface ModelProvider {
  readonly id: string;
  decide(context: AgentContext, timeoutMs: number): Promise<AgentResponse>;
}

// No implementation may return a fictitious fundable address, balance, or receipt.
export interface WalletProvider {
  readonly mode: 'circle';
  balance(address: string): Promise<bigint>;
  createAgentWallet(agentId: string): Promise<string>;
}
export interface SettlementProvider {
  readonly mode: 'arc';
  enter(tournamentId: string, agentId: string, amount: bigint): Promise<{ txHash: string }>;
  settle(tournamentId: string, winners: { address: string; amount: bigint }[]): Promise<{ txHash: string }>;
}

/** Timeout/invalid-response policy: check when legal, otherwise fold. */
export async function requestValidatedAction(
  provider: ModelProvider,
  player: Player,
  highestBet: number,
  context: AgentContext,
  timeoutMs: number,
): Promise<AgentResponse> {
  const fallback: AgentResponse = player.contribution === highestBet ? { action: 'check' } : { action: 'fold' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      provider.decide(context, timeoutMs),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Agent decision timed out')), timeoutMs);
      }),
    ]);
    return validateAction(player, highestBet, response);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
