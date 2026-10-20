import { describe, expect, it } from 'vitest';
import { parseRoute } from './routes';

describe('V4 routes', () => {
  it('the main menu is the default', () => {
    expect(parseRoute('')).toEqual({ screen: 'modes' });
    expect(parseRoute('#/')).toEqual({ screen: 'modes' });
    expect(parseRoute('#/nonsense')).toEqual({ screen: 'modes' });
  });
  it('each mode has its own stable route; the old #/duel stays the Prepared Boss', () => {
    expect(parseRoute('#/prepared')).toEqual({ screen: 'prepared' });
    expect(parseRoute('#/duel')).toEqual({ screen: 'prepared' });
    expect(parseRoute('#/learning')).toEqual({ screen: 'learning' });
    expect(parseRoute('#/pvp')).toEqual({ screen: 'pvp-setup' });
  });
  it('run ids open the run screen (boss modes) or the PvP match, never each other', () => {
    expect(parseRoute('#/duel/12')).toEqual({ screen: 'run', runId: 12 });
    expect(parseRoute('#/pvp/12')).toEqual({ screen: 'pvp-match', runId: 12 });
    expect(parseRoute('#/duel/abc')).toEqual({ screen: 'prepared' });
    expect(parseRoute('#/pvp/0')).toEqual({ screen: 'pvp-setup' });
  });
});
