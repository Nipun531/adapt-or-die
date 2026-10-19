---
name: The Boss Remembers
description: A duel against a boss that learns you, set as lit glass in a dark nave.
colors:
  nave: "#0e0f12"
  nave-2: "#121418"
  stone: "#17191d"
  stone-2: "#1f2227"
  stone-3: "#272a30"
  lead: "#2c2f35"
  lead-2: "#3a3e46"
  pane-off: "#22252b"
  text: "#e6e3dc"
  text-2: "#b2aea6"
  text-3: "#8b8780"
  azure: "#3d74d8"
  azure-glass: "#2f60bd"
  azure-text: "#8fb3f2"
  gules: "#cf3b41"
  gules-glass: "#b3313a"
  gules-text: "#f0868a"
  amber: "#dfa634"
  amber-text: "#f0c56a"
  violet: "#8a64d6"
  violet-text: "#b9a0f0"
  verdant: "#4f9d66"
  verdant-text: "#8cd2a2"
  clear: "#c9d3d8"
  fan-equal: "#26222c"
  fan-played: "#2a1a1c"
  fx-hit-gules: "rgb(207 59 65 / 0.12)"
  fx-hit-azure: "rgb(61 116 216 / 0.12)"
  fx-block: "rgb(201 211 216 / 0.22)"
  fx-clear-held: "rgb(201 211 216 / 0.08)"
  fx-counter: "rgb(223 166 52 / 0.38)"
  fx-counter-held: "rgb(223 166 52 / 0.1)"
  fx-stun: "rgb(138 100 214 / 0.34)"
  fx-stun-held: "rgb(138 100 214 / 0.12)"
  fx-heal: "rgb(79 157 102 / 0.4)"
  fx-heal-held: "rgb(79 157 102 / 0.12)"
  fx-skip: "rgb(14 15 18 / 0.5)"
  fx-word-plate: "rgb(14 15 18 / 0.86)"
  backdrop: "rgb(8 9 11 / 0.72)"
typography:
  display:
    fontFamily: "Marcellus SC, Atkinson Hyperlegible, serif"
    fontSize: "3.25rem"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "0.04em"
  headline:
    fontFamily: "Marcellus SC, Atkinson Hyperlegible, serif"
    fontSize: "1.6rem"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "0.04em"
  title:
    fontFamily: "Marcellus SC, Atkinson Hyperlegible, serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "0.04em"
  inscription-word:
    fontFamily: "Marcellus SC, Atkinson Hyperlegible, serif"
    fontSize: "1.6rem"
    fontWeight: 400
    letterSpacing: "0.08em"
  numeral:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1
    fontFeature: "tnum"
  numeral-small:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.15
    fontFeature: "tnum"
  body:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 700
    letterSpacing: "0.08em"
rounded:
  cell: "1px"
  lead-frame: "2px"
  r: "3px"
  pill: "999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
  s7: "48px"
  seam-gap: "3px"
components:
  button-primary:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.nave}"
    typography: "{typography.body}"
    rounded: "{rounded.r}"
    padding: "0 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.amber-text}"
    textColor: "{colors.nave}"
  button-secondary:
    backgroundColor: "{colors.stone-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.r}"
    padding: "0 16px"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.stone-3}"
  button-danger:
    textColor: "{colors.gules-text}"
    rounded: "{rounded.r}"
    padding: "0 16px"
    height: "40px"
  button-danger-hover:
    backgroundColor: "{colors.gules-glass}"
  chip:
    textColor: "{colors.text-2}"
    typography: "{typography.body-small}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "32px"
  chip-on:
    backgroundColor: "{colors.stone-3}"
    textColor: "{colors.text}"
  input:
    backgroundColor: "{colors.stone-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.r}"
    padding: "6px 10px"
  panel:
    backgroundColor: "{colors.stone}"
    textColor: "{colors.text}"
    rounded: "{rounded.r}"
    padding: "24px"
  item-card:
    backgroundColor: "{colors.stone-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.cell}"
    padding: "12px"
  item-card-hover:
    backgroundColor: "{colors.stone-3}"
  answer:
    backgroundColor: "{colors.stone-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.r}"
    padding: "16px"
  answer-hover:
    backgroundColor: "{colors.stone-3}"
  window:
    backgroundColor: "{colors.stone}"
    textColor: "{colors.text}"
    padding: "16px 24px 24px"
  fan-card:
    backgroundColor: "{colors.pane-off}"
    textColor: "{colors.text}"
    rounded: "{rounded.cell}"
    padding: "12px"
  fan-card-equal:
    backgroundColor: "{colors.fan-equal}"
  fan-card-played:
    backgroundColor: "{colors.fan-played}"
  fan-card-weaker:
    backgroundColor: "{colors.nave}"
---

# Design System: The Boss Remembers

## Overview

**Creative North Star: "Cathedral Lead-Light"**

A dark nave where colour exists only as lit glass, and glass lights only when something happens. The ground is night-nave black, every working surface is a slab of dark stone, and stone slabs and glass cells are separated by dark lead seams, never by shadows. Colour is not decoration: six jewel tinctures each mean exactly one thing, and they appear only where a pane is lit by game state (your health, the boss's health, the decision in front of you, a stun, a heal, a block).

The fight is two lancet windows facing each other across an aisle, the player's lit in azure and the boss's in gules, with the one decision you must answer between them as the single amber-ringed pane. Health and stun are rows of leaded panes rather than bars; gear is shown as segmented glass roundels lit in the owner's tincture; the boss's ranked plans are a fan of leaded cells. Every exchange plays out as light in the struck window, one short, purposeful animation per outcome, and each has a held, motionless equivalent under reduced motion.

Names and short word inscriptions are cut in Marcellus SC; everything read, and every numeral, is set in Atkinson Hyperlegible. The world refuses the gold-filigree RPG panel and the grey analytics dashboard.

**Key Characteristics:**
- Nave ground, stone surfaces, lead seams: depth by tone and seam, never by shadow.
- Six tinctures, one meaning each: azure you, gules boss, amber your decision now, violet stun, verdant healing, clear glass blocked or dodged.
- Leaded pane meters for HP and stun; leaded cell grids for armory, stats, rewards and the boss's plans.
- Gear as flat, eight-segment glass roundels lit in the owner's tincture.
- Marcellus SC for word inscriptions only; Atkinson Hyperlegible for UI and all numerals.
- One outcome animation per exchange (hit, block, dodge, counter, stun, heal, skip, strike, KO), each with a reduced-motion held state.

## Colors

A near-black nave and three stone greys carry the whole shell; saturated colour is reserved for lit glass, and each tincture has three steps: the glass itself, a deeper glass for borders and roundel segments, and a lighter text tint that stays legible on stone.

### Primary
- **Amber Lantern** (amber, with amber-text): the one decision that matters now. The incoming pane's 2px ring, the answer odds numerals, the primary button, the selected armory cell outline, the pick panel, focus rings, text selection, caret, checkbox accent, stat points left to spend, and counters (the fx-counter flash, the counter exchange pane). Nothing else.

### Secondary
- **Azure Window** (azure, azure-glass, azure-text): you. Your window's 4px top lead, your lit HP panes, your filled roundels, your hits on the boss (fx-hit from the player), owned-item top bar, XP bar, win result and win chips.
- **Gules Window** (gules, gules-glass, gules-text): the boss. The boss window's top lead, its HP panes and roundels, its hits on you, the played fan card's outline, memory evidence severity, loss result, negative modifiers and the danger button.

### Tertiary
- **Violet Stun** (violet, violet-text): stun only. Stun pane row, the fx-stun flood and the "Turn lost" skip word, stun and skip exchange panes.
- **Verdant Healing** (verdant, verdant-text): healing only. Stim vials, the fx-heal rise, heal answers, stim exchange panes, positive build deltas and OK states.
- **Clear Glass** (clear): blocked or dodged. The fx-block ring and wash, the "Blocked" / "Dodged" words, block and dodge exchange panes.

### Neutral
- **Night Nave** (nave, nave-2): page ground, top bar, primary-button text, weaker fan cards; nave-2 for inset wells (pick panel, boss hand, roundel cores, phone action bar).
- **Stone** (stone, stone-2, stone-3): panels and windows; cells, buttons and inputs; hover and selected cells.
- **Lead** (lead, lead-2): seams between every surface and the ground colour behind leaded cell grids; lead-2 for button borders, dialogs and hover seams.
- **Unlit Glass** (pane-off): unlit HP and stun panes, empty roundels, meter tracks, default fan cards.
- **Bone Text** (text, text-2, text-3): primary text, secondary text, tertiary meta and empty slots.
- **Fan Tones** (fan-equal, fan-played): the boss's equally strong plans glow faintly violet-grey; the played plan is a dark gules-tinted cell.

### Named Rules
**The One Meaning Rule.** Each tincture means one thing everywhere: azure you, gules boss, amber the decision now (and counters), violet stun, verdant healing, clear blocked or dodged. Never use a tincture as decoration or for a second meaning.

**The Lit Glass Rule.** Saturated colour appears only where game state lights a pane. The shell (top bar, ground, panel fills, nav) stays nave, stone and lead.

**The Text Tint Rule.** Tincture text on stone uses the -text step (azure-text, gules-text, amber-text, violet-text, verdant-text); the base glass steps are for fills, rings and panes.

## Typography

**Display Font:** Marcellus SC (with Atkinson Hyperlegible, serif)
**Body Font:** Atkinson Hyperlegible (with system-ui, sans-serif)

**Character:** Inscriptional small caps cut into stone for names and words; a hyperlegible sans for everything a player has to read or compare.

### Hierarchy
- **Display** (Marcellus SC 400, 3.25rem; start hero clamp(2.4rem, 5vw, 4rem); result headline clamp(2.4rem, 5vw, 3.6rem); 1.1): the start title and Victory / Defeat.
- **Headline** (Marcellus SC 400, 1.6rem, 1.1, 0.04em): fighter names, run title, rules drawer title.
- **Title** (Marcellus SC 400, 1.25rem; h4 1rem at 0.06em): panel and section headings; the incoming pane question at 2.25rem; phase tabs at 1.05rem; item names at 1.1rem.
- **Inscription Word** (Marcellus SC 400, 1.6rem, 0.08em): Block / Dodge answer names and the fx outcome words (Blocked, Dodged, Countered, Stunned, Healed, Turn lost, Fallen).
- **Numeral** (Atkinson 700, 2rem/1, tabular): HP in the windows; answer odds at 1.5rem; build stats at 1.35rem; costs and point values at 1.05 to 1.2rem.
- **Body** (Atkinson 400, 1rem, 1.5): all reading text; ledes capped at 56 to 70ch. The incoming pane switches to Atkinson 1.25rem while an exchange plays, because it is then a sentence.
- **Label** (Atkinson 700, 0.78rem, 0.06 to 0.08em, uppercase): meter labels (Health, Stun, Stims), roundel slot names, delta labels, table headers.

### Named Rules
**The Legible Numeral Rule.** Every numeral is Atkinson Hyperlegible 700 with tabular figures, including numerals inside Marcellus headings (wrap them in the numeral style). Marcellus SC's 0 and 1 read as O and I.

**The Inscription Rule.** Marcellus SC carries names and short words only; sentences are never set in it.

## Layout

A single centred column (max 1360px) of stone panels on the nave with 24px page padding and 16px gaps, on a 4-point spacing scale. The fight stage is three tracks: your window (minmax(250px, 320px)), the incoming pane (minmax(0, 1fr)), the boss window (minmax(250px, 320px)), with 24px gutters. Prepare is the armory (minmax(0, 1fr)) beside a 360px sticky build column. Every flexible grid track is declared minmax(0, 1fr) so long content never blows out a column. The round history sits below the fold, one row per round.

Breakpoints: at 1080px the stage becomes two windows side by side with the incoming pane spanning above them, and Prepare stacks. At 760px everything is one column with the incoming pane first, roundels sit three across with centred text, the armory is two columns, answers stay two across, page padding drops to 12px, and a sticky bottom action bar replaces the phase-bar primary action.

## Elevation & Depth

Flat. There are no drop shadows anywhere: depth is tonal (nave below stone below stone-2 below stone-3) and every edge is a 1px lead seam. Grouped cells are leaded: a lead-coloured frame with 3px padding and 3px gaps, the cells inside at 1px corners, so the seam is the ground showing through. The only inset rings are state light inside an outcome animation (the 3px clear, violet or tincture ring of fx states), not elevation.

### Named Rules
**The Lead Seam Rule.** Separate surfaces with a 1px lead seam or a 3px leaded gap, never a shadow. A thing is raised only by being lighter stone.

**The Leaded Grid Rule.** Any set of peer cells (armory, build stats, rewards, status, the boss's plans, HP and stun panes) is a leaded grid: lead ground, 3px padding, 3px gaps, 1px cell corners.

## Shapes

Nearly square. The base radius is 3px for panels, buttons, inputs, cards and menus; cells inside a leaded grid are 1px, and the lead frame around panes and fans is 2px. Pills (999px) are only chips. Windows and result panels are square-topped with a 4px tincture lead along the top and 3px corners only at the bottom. Roundels are the one circle: a 3px lead ring around eight 45-degree glass segments with a lead-ringed nave core. Stim vials are small rounded-bottom tubes (3px 3px 7px 7px).

## Components

### Buttons
- **Shape:** gently squared (3px), 40px tall, 16px side padding; big 48px, small 32px.
- **Primary:** amber fill, nave text, 700 weight; hover lightens to amber-text. One per view: the action that advances the loop.
- **Secondary:** stone-2 fill with a lead-2 border; hover stone-3 and a text-3 border.
- **Quiet / Ghost:** transparent with the lead-2 border.
- **Danger:** transparent with a gules border and gules-text; hover fills gules-glass with white text.
- **Focus:** every control gets the 2px amber outline at 2px offset.

### Chips
- **Style:** 32px pill, lead seam, text-2, 0.875rem 700.
- **State:** on is stone-3 with text and a text-3 border; tincture variants (points amber, ok verdant, bad gules) recolour border and text only.

### Cards / Containers
- **Corner Style:** 3px panels; 1px cells inside leaded grids.
- **Background:** stone panels; stone-2 cells; nave-2 inset wells.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px lead seam.
- **Internal Padding:** 24px panels (16px / 12px on phones); 12px cells.

### Inputs / Fields
- **Style:** stone-2 fill, lead seam, 3px, 6px 10px padding; hover seam lead-2.
- **Focus:** the global 2px amber outline.

### Navigation
- **Style:** sticky 56px nave top bar with a lead seam below; Marcellus SC brand with an amber mark; Atkinson 700 links in text-2, current link in text with a 2px text-colour underline. Phase tabs (Prepare / Fight / Aftermath) are Marcellus SC 1.05rem with the same 2px underline. On phones, link icons drop and padding tightens.

### Fighter Window (signature)
Stone panel with a 4px tincture top lead (azure you, gules boss). Name in Marcellus, HP as a 2rem Atkinson numeral over ten leaded HP panes (16px, lit in the owner's tincture), a row of 10px stun panes lit violet, verdant stim vials, then gear roundels (56px) for hands and body.

### Incoming Pane (signature)
The centre stone pane, the only element ringed in amber (2px, inset) while it waits for your answer. Question in Marcellus at 2.25rem; two answer cards (stone-2, lead-2 border, 16px padding) with the answer name in Marcellus and its odds as an amber-text Atkinson numeral; hover gives an amber border and a 1px lift.

### Gear Roundel
48px circle (56px in windows, 32px compact): unlit pane-off with a text-3 icon when empty; when filled, flat conic glass alternating the owner's glass and base tinctures in eight segments, a lead-ringed nave core and a light icon.

### Outcome Animations
Each exchange plays once in the struck window (exponential ease-out, 620ms): hit cracks a diagonal band of the attacker's tincture across the window and shudders it; block washes clear glass with a 3px clear ring and braces; dodge slides the window aside; counter flashes amber; stun floods violet (1100ms); heal rises verdant (800ms); skip dims to nave and reads "Turn lost"; strike leans the attacker's window; KO desaturates the window and hatches its HP panes. A Marcellus word on a nave plate names the outcome. Under prefers-reduced-motion every animation is replaced by a held state: a 3px ring in the outcome's tincture, a faint tint wash and the word fixed at the bottom of the window.

### Boss's Hand
A leaded fan of plan cells (min 120px, 64px compact): the played plan is the dark gules cell with a 2px gules outline, equally strong plans the faint fan-equal cell, weaker plans sink to nave.

## Do's and Don'ts

### Do:
- **Do** keep each tincture to its one meaning: azure you, gules boss, amber the decision now, the primary action, selection, focus and counters, violet stun, verdant healing, clear blocked or dodged.
- **Do** separate surfaces with 1px lead seams and group peer cells in leaded grids (3px lead padding and gaps, 1px cell corners).
- **Do** set every numeral in Atkinson Hyperlegible 700 with tabular figures, including inside Marcellus headings.
- **Do** show meters as rows of leaded panes and gear as segmented glass roundels lit in the owner's tincture.
- **Do** give every outcome animation a held reduced-motion state with a tincture ring and its word.
- **Do** declare flexible grid tracks as minmax(0, 1fr) and collapse at 1080px and 760px.

### Don't:
- **Don't** use drop shadows for depth; the only inset rings are outcome light.
- **Don't** set numerals or sentences in Marcellus SC.
- **Don't** light a tincture for decoration, or give amber to anything other than the decision now, primary action, selection, focus or counters.
- **Don't** round surfaces past 3px or use pills for anything but chips.
- **Don't** use Unicode glyphs for icons; icons are the authored 24-grid SVG set.
- **Don't** drift toward the gold-filigree RPG panel or the grey dashboard.
