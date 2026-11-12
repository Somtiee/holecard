import { useCallback, useEffect, useState } from 'react';
import { type NearConfig } from '../components/NearPanels';
import { api, type Agent, type Decision, type Health, type Ranking, type Thinking, type Tournament } from './api';

export function useArena() {
  const [agents, setAgents] = useState<Agent[]>([]),
    [tournaments, setTournaments] = useState<Tournament[]>([]),
    [leaders, setLeaders] = useState<Ranking[]>([]),
    [config, setConfig] = useState<NearConfig | null>(null),
    [health, setHealth] = useState<Health | null>(null),
    [owner, setOwner] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [action, setAction] = useState<{ tournamentId: string; action: Decision } | null>(null),
    [thinking, setThinking] = useState<Thinking | null>(null);
  // Fast-changing lists poll every 10 s (and on live events); config, health and session change rarely.
  const refreshLists = useCallback(async () => {
    const [a, t, l] = await Promise.all([
      api<Agent[]>('/api/agents'),
      api<Tournament[]>('/api/tournaments'),
      api<Ranking[]>('/api/leaderboard'),
    ]);
    setAgents(a);
    setTournaments(t);
    setLeaders(l);
  }, []);
  const refreshStatus = useCallback(async () => {
    const [c, h, m] = await Promise.all([
      api<NearConfig>('/api/config'),
      api<Health>('/api/health'),
      api<{ accountId: string | null }>('/api/me'),
    ]);
    setConfig(c);
    setHealth(h);
    setOwner(m.accountId);
  }, []);
  const refresh = useCallback(async () => {
    try {
      await Promise.all([refreshLists(), refreshStatus()]);
    } finally {
      setLoading(false);
    }
  }, [refreshLists, refreshStatus]);
  useEffect(() => {
    void refresh().catch(() => setLoading(false));
    const every = (ms: number, fn: () => Promise<void>) =>
      setInterval(() => {
        if (!document.hidden) void fn().catch(() => {});
      }, ms);
    const lists = every(10_000, refreshLists),
      status = every(30_000, refreshStatus);
    const onVisible = () => {
      if (!document.hidden) void refreshLists().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(lists);
      clearInterval(status);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, refreshLists, refreshStatus]);
  useEffect(() => {
    // Live feed: turn/action events update the table immediately; list data is re-read at most once per 1.5 s.
    // The socket reconnects with backoff if the server restarts or the network drops.
    let socket: WebSocket | null = null,
      closed = false,
      retry = 0,
      reconnect: ReturnType<typeof setTimeout> | undefined,
      pending: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      if (!pending)
        pending = setTimeout(() => {
          pending = undefined;
          void refreshLists().catch(() => {});
        }, 1500);
    };
    const open = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      socket.onopen = () => {
        if (retry) soon();
        retry = 0;
      };
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.event === 'hand.action') {
            setAction(message.data);
            setThinking(null);
          } else if (message.event === 'turn.thinking') {
            setThinking(message.data);
            setAction(null);
          }
          if (message.event !== 'connected' && message.event !== 'turn.thinking') soon();
        } catch {
          /* ignored */
        }
      };
      socket.onclose = () => {
        if (closed) return;
        reconnect = setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++));
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(reconnect);
      clearTimeout(pending);
      socket?.close();
    };
  }, [refreshLists]);
  return { agents, tournaments, leaders, config, health, owner, setOwner, loading, refresh, action, thinking };
}
