/** One primary action per round phase, rendered inline by the phase that owns it. */
export interface PhaseAction { label: string; onClick: () => void; disabled?: boolean; hint?: string }
