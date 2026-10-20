/**
 * V4 main menu: the three game modes. Each card says plainly where the opponent's knowledge comes from, so the
 * difference between the Prepared Boss and the Learning Boss is clear before anyone starts.
 */
import { Icon } from '../ui/Icon';

const MODES = [
  {
    id: 'prepared', hash: '#/prepared', title: 'Prepared Boss', cta: 'Face the Prepared Boss',
    text: 'Face a boss prepared with knowledge of common strategies. Its general tactical knowledge is there from the first round.',
    facts: ['Knows the rules and common builds', 'Studies how you fought last round'],
  },
  {
    id: 'learning', hash: '#/learning', title: 'Learning Boss', cta: 'Face the Learning Boss',
    text: 'Fight a boss that starts knowing only the rules. It learns from your own encounters, adapts to your builds and remembers them across runs in this browser.',
    facts: ['Starts with nothing learned about you', 'Learns only from your completed rounds'],
  },
  {
    id: 'pvp', hash: '#/pvp', title: 'PvP Arena', cta: 'Set up a local match',
    text: 'Challenge another player on this device. Your opponent is a human, not an AI boss. You take turns, and each build stays hidden until the fight.',
    facts: ['Two players, one device', 'Same rules for both'],
  },
];

export function ModeSelect() {
  return (
    <div className="modes">
      <header className="modes-head">
        <h1>The Boss Remembers</h1>
        <p className="start-lede">Arm yourself between rounds, then answer every blow with a block or a dodge. Choose who you face.</p>
      </header>
      <ul className="mode-grid">
        {MODES.map((m) => (
          <li key={m.id} className={`mode-card mode-${m.id}`}>
            <h2>{m.title}</h2>
            <p>{m.text}</p>
            <ul className="mode-facts">{m.facts.map((f) => <li key={f}>{f}</li>)}</ul>
            <a className="btn btn-primary" href={m.hash}>{m.cta} <Icon name="arrow" /></a>
          </li>
        ))}
      </ul>
    </div>
  );
}
