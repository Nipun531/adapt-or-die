/** V4 hash routes → which screen renders. Pure, so routing and mode isolation are unit-tested (routes.test.ts). */
export type Route =
  | { screen: 'modes' }
  | { screen: 'prepared' }
  | { screen: 'learning' }
  | { screen: 'run'; runId: number }
  | { screen: 'pvp-setup' }
  | { screen: 'pvp-match'; runId: number }
  | { screen: 'runs' } | { screen: 'sim' } | { screen: 'ml' };

const idOf = (x?: string) => (x && /^\d+$/.test(x) && Number(x) > 0 ? Number(x) : null);

export function parseRoute(hash: string): Route {
  const [, section, arg] = (hash || '#/').split('/');
  switch (section) {
    case 'duel': case 'prepared': {
      const id = section === 'duel' ? idOf(arg) : null;
      return id ? { screen: 'run', runId: id } : { screen: 'prepared' };
    }
    case 'learning': return { screen: 'learning' };
    case 'pvp': { const id = idOf(arg); return id ? { screen: 'pvp-match', runId: id } : { screen: 'pvp-setup' }; }
    case 'runs': return { screen: 'runs' };
    case 'sim': return { screen: 'sim' };
    case 'ml': return { screen: 'ml' };
    default: return { screen: 'modes' };
  }
}
