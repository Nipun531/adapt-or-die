---
name: The Boss Remembers
description: Court Deck — a duel played as a hand of court cards on a green baize table.
colors:
  baize-950: "#0b2219"
  baize-900: "#0f2a20"
  baize-800: "#163a2c"
  baize-700: "#1e4b39"
  baize-600: "#285f49"
  on-baize: "#eef3ef"
  on-baize-2: "#b9d0c2"
  on-baize-player: "#9db4f0"
  on-baize-boss: "#ff9aa9"
  stock: "#f7f5f0"
  stock-2: "#eeeae1"
  stock-3: "#e2ddd1"
  card-face: "#ffffff"
  line: "#d3ccbd"
  ink: "#141414"
  ink-2: "#474540"
  ink-3: "#6b675e"
  court-red: "#c4122f"
  court-red-ink: "#a50f27"
  court-blue: "#1f3c8c"
  court-blue-ink: "#182f70"
  court-yellow: "#f0b323"
  court-yellow-soft: "#f8e2a6"
  owned-tint: "#f3f6fd"
  owned-line: "#b9c6e8"
  warn-bg: "#fbecc4"
  warn-ink: "#6e4a00"
  err-bg: "#f9dde1"
  err-ink: "#8a0c21"
  ok-bg: "#dfe8f8"
  ok-ink: "#182f70"
typography:
  display:
    fontFamily: "Big Shoulders Display, Atkinson Hyperlegible, sans-serif"
    fontSize: "clamp(2.6rem, 6vw, 5rem)"
    fontWeight: 800
    lineHeight: 0.92
    letterSpacing: "0.02em"
  headline:
    fontFamily: "Big Shoulders Display, Atkinson Hyperlegible, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "0.02em"
  title:
    fontFamily: "Big Shoulders Display, Atkinson Hyperlegible, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "0.02em"
  index-numeral:
    fontFamily: "Big Shoulders Display, Atkinson Hyperlegible, sans-serif"
    fontSize: "2.6rem"
    fontWeight: 800
    lineHeight: 1
    fontFeature: "tnum"
  index-label:
    fontFamily: "Big Shoulders Display, Atkinson Hyperlegible, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 700
    letterSpacing: "0.12em"
  body:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.45
  body-small:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 700
    letterSpacing: "0.04em"
rounded:
  tag: "5px"
  sm: "8px"
  control: "10px"
  face: "12px"
  card: "14px"
  pill: "999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
  s7: "48px"
  module: "168px"
  page-max: "1320px"
components:
  button-primary:
    backgroundColor: "{colors.court-red}"
    textColor: "{colors.card-face}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.court-red-ink}"
  button-big:
    backgroundColor: "{colors.court-red}"
    textColor: "{colors.card-face}"
    typography: "{typography.title}"
    rounded: "{rounded.control}"
    padding: "0 24px"
    height: "52px"
  button-quiet:
    backgroundColor: "{colors.stock-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  button-quiet-hover:
    backgroundColor: "{colors.stock-3}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.on-baize}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.card-face}"
    rounded: "{rounded.control}"
    height: "44px"
  chip:
    backgroundColor: "{colors.card-face}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "32px"
  chip-on:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.card-face}"
  chip-dark:
    backgroundColor: "{colors.baize-900}"
    textColor: "{colors.on-baize}"
  tag-blue:
    backgroundColor: "{colors.court-blue}"
    textColor: "{colors.card-face}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "1px 7px"
  tag-yellow:
    backgroundColor: "{colors.court-yellow}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tag}"
    padding: "1px 7px"
  input:
    backgroundColor: "{colors.card-face}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "40px"
  panel-stock:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "24px"
  court-card:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "16px 24px 16px 16px"
  item-card:
    backgroundColor: "{colors.card-face}"
    textColor: "{colors.ink}"
    rounded: "{rounded.face}"
    padding: "12px"
    height: "168px"
    width: "{spacing.module}"
  item-card-owned:
    backgroundColor: "{colors.owned-tint}"
  phase-tab:
    backgroundColor: "{colors.baize-800}"
    textColor: "{colors.on-baize-2}"
    typography: "{typography.title}"
    padding: "0 24px"
    height: "44px"
  phase-tab-on:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
  fan-card:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
    rounded: "{rounded.face}"
    padding: "12px"
    width: "132px"
    height: "184px"
---

# Design System: The Boss Remembers

## Overview

**Creative North Star: "The Court Deck"**

Every screen is a card table. The ground is deep green baize; every working surface is a sheet of off-white card stock laid on it; every item, fighter and plan is a playing card with rounded corners and a thin printed inner frame. Colour is printed, not lit: four flat court inks (red, blue, yellow, black) that appear only on card faces and on state. The shell itself is baize, stock and ink, so when red or blue appears it carries meaning (the boss, the player, a loss, a win).

Density is that of a working card game, not a dashboard: a grid of equal-sized item cards, two large face-up court cards for the fighters, and a fan of cards for the boss's plans. Numbers are read like card indices, in a tall condensed face, large and tabular; everything that has to be read as language is set in Atkinson Hyperlegible. Depth is the physical depth of cards on felt: soft green-tinted shadows, a lift on hover, a tilt when a card is picked.

The world explicitly refuses the dark-parchment RPG panel and the grey analytics dashboard.

**Key Characteristics:**
- Baize ground, card-stock panels, white card faces: three material layers, always in that order.
- Four flat court inks; saturated colour only on card faces and state.
- One card form (rounded corners plus a printed inner frame) used at three sizes: court card, item card, fan card.
- Suit pips stand for stats everywhere: heart HP, spade STR, diamond DEF, club DEX, drawn as authored SVG.
- Condensed uppercase index face for headings and numerals; hyperlegible sans for all reading text.
- Blue is always the player, red is always the boss.

## Colors

A felt-and-print palette: a five-step baize ramp, three steps of warm card stock, three inks, and four flat court colours.

### Primary
- **Court Red** (`court-red`): the boss's colour and the one primary action colour (Begin round, Prepare next round, See what the boss learned). Also the loss result panel, the selected item card's ring, and negative stat modifiers (in its deeper **Red Ink** `court-red-ink`, also the primary button hover).

### Secondary
- **Court Blue** (`court-blue`): the player's colour. Player level, player damage, player HP meters, the win result panel, pierce tags, text links, positive deltas. **Blue Ink** (`court-blue-ink`) is its text-on-tint partner.

### Tertiary
- **Court Yellow** (`court-yellow`): attention and the "now". Focus rings, the current-nav underline, the played card's ring in the boss's fan, the VS mark, First Shot tags, XP meters, level-up rows, unspent-points chip, text selection. **Soft Yellow** (`court-yellow-soft`) backs the in-fight choice box.

### Neutral
- **Baize 700** (`baize-700`): the page ground and the inside of the boss-hand figure.
- **Baize 900 / 950** (`baize-900`, `baize-950`): the top bar and its rule; the phone action bar; dialog backdrop tint.
- **Baize 800 / 600** (`baize-800`, `baize-600`): inactive phase tabs and their hover; scrollbars and dark-chip borders.
- **On-Baize / On-Baize 2** (`on-baize`, `on-baize-2`): primary and secondary text directly on felt.
- **On-Baize Player / Boss** (`on-baize-player`, `on-baize-boss`): lightened blue and red for the win-loss record when it sits on baize, where the court inks would be too dark to read.
- **Stock / Stock 2 / Stock 3** (`stock`, `stock-2`, `stock-3`): panel stock, recessed wells and quiet buttons, internal rules and meter tracks.
- **Card Face** (`card-face`): pure white for the faces that sit on stock (item cards, chips, inputs, filled slots, evidence rows, status tiles), so a card reads as lighter than the panel it lies on.
- **Line** (`line`): card edges, chip borders, dashed empty slots.
- **Ink / Ink 2 / Ink 3** (`ink`, `ink-2`, `ink-3`): text on stock, in three strengths; ink also fills the selected filter chip and the destructive button.
- **Owned Tint / Owned Line** (`owned-tint`, `owned-line`): the pale blue face and edge of an item the player already holds, and of a filled hand slot.
- **State pairs** (`warn-bg`/`warn-ink`, `err-bg`/`err-ink`, `ok-bg`/`ok-ink`): banners, inline notes, error and success states. Always used as a pair.

### Named Rules
**The Printed Ink Rule.** Saturated red, blue and yellow appear only on card faces and on state. The shell (top bar, page ground, panel stock) is baize, stock and ink, never a court colour.

**The Two Sides Rule.** Blue is the player and red is the boss, everywhere: level numerals, damage, HP meters, fight-log sides, the record, result panels. Never swap them and never use either as decoration.

**The Felt Legibility Rule.** On baize, the court inks are replaced by their on-baize tints (`on-baize-player`, `on-baize-boss`) or by yellow; dark red or blue text never sits directly on felt.

## Typography

**Display Font:** Big Shoulders Display (700, 800; fallback Atkinson Hyperlegible, sans-serif)
**Body Font:** Atkinson Hyperlegible (400, 700; fallback system-ui, sans-serif)

**Character:** a tall condensed card-index face for everything that is counted or named, against a sans built for legibility for everything that is read. Both are self-hosted.

### Hierarchy
- **Display** (800, clamp(2.6rem, 6vw, 5rem), 0.92): the start screen title and the round result headline only.
- **Headline** (800, 1.75rem, 1.05, uppercase): panel headings (Armory, Your Hand, The Boss Remembers), the run title, court card names.
- **Title** (800, 1.25rem, 1.05, uppercase): sub-section headings (Stat Points, The Boss's Last Hand), phase tabs (1.15rem) and the big primary button (1.3rem).
- **Index Numeral** (800, 1.5 to 3rem, line-height 0.85 to 1, tabular): HP, level, Net stats, damage per hit, item cost, gold, draw probability. Sizes step with the card size: 3rem level on the court card, 2.6rem HP, 1.9rem damage and fan index, 1.5rem item cost.
- **Index Label** (700, 0.72 to 0.8rem, 0.12em, uppercase): the small printed labels on a card or row (LVL under the level, Hand 1 / Hand 2 / Body slot labels, Turn N in the fight log).
- **Body** (400, 1rem, 1.45): all reading text; ledes capped at 72ch.
- **Body Small** (400, 0.875rem): card meta, captions, the fight calculation, memory evidence.
- **Label** (700, 0.78rem, 0.04em): stat pip labels (STR, DEF, DEX), tags, button kbd hints.

### Named Rules
**The Index Rule.** Every number a player compares (HP, stats, damage, cost, gold, probability) is set in the index face at a size larger than its label, with tabular figures. Sentences are never set in the index face.

**The Uppercase Index Rule.** Headings in the index face are uppercase with slight tracking (0.02 to 0.06em); Atkinson text is never uppercased except table header cells and the small fight-summary side labels.

## Layout

A single centred column, max 1320px (`page-max`), 16px side gutter, 24px between blocks; the top bar spans full width with its content aligned to the same column.

The duel screen stacks: run header (title, round, record, End run), the versus row (player court card, an 84px centre column with VS and the record, boss court card), the phase bar, then the phase body. The phase bar's tabs sit flush on the panel below (the active tab is stock-coloured and the panel's top-left corner is square), like a folder tab.

Prepare is a two-column grid: the Armory (fluid) and the hand column (380px). The Armory is a card grid of `auto-fill, minmax(168px, 1fr)`; 168px is the card-width module. The picked card's preview opens as a full-width row directly under the picked card.

Spacing is a 4-point scale (4, 8, 12, 16, 24, 32, 48). Card internals use 12px; panels use 24px (16px on phones); gaps between cards are 12px.

Responsive: at 1080px and below, Prepare, the aftermath memory grid and the result panel go to one column and the phase-bar Begin button hides (it remains at the foot of the hand column). At 760px and below the top bar drops to 56px, the court cards shrink to a compact two-up (level index moves top right, gear, XP and gold hide), the VS column hides and the record moves into the run header, phase tabs share the width equally, the Armory goes to two columns, the fight log stacks each attack within its side, and Begin round becomes a fixed bottom action bar on dark baize.

## Elevation & Depth

Depth is cards on felt: shadows are soft and green-tinted (from `baize-950`), never black boxes and never hard offsets. Panels rest at a low lift; overlays (menus, dialogs, toasts, phone action bar) take the high lift. Hover raises a card by translation, not by a heavier shadow alone. The fan cards in the boss's hand carry their own neutral shadow because they are stacked over each other.

### Shadow Vocabulary
- **Lift 1** (`box-shadow: 0 1px 2px rgb(11 34 25 / 0.25), 0 2px 8px rgb(11 34 25 / 0.18)`): panels, court cards, the brand mark, hovered item cards, result panels.
- **Lift 2** (`box-shadow: 0 4px 12px rgb(11 34 25 / 0.28), 0 12px 32px rgb(11 34 25 / 0.22)`): the Workshop menu, dialogs, toasts, the phone action bar.
- **Primary glow** (`box-shadow: 0 1px 2px rgb(11 34 25 / 0.3), 0 6px 14px rgb(196 18 47 / 0.25)`): the red primary button only.
- **Fan card** (`box-shadow: 0 2px 4px rgb(0 0 0 / 0.25), 0 8px 16px rgb(0 0 0 / 0.2)`); the played card adds a 3px yellow ring and a deeper drop (`0 0 0 3px #f0b323, 0 14px 28px rgb(0 0 0 / 0.38)`).

### Named Rules
**The Felt Shadow Rule.** Shadows are tinted toward baize and always blurred. A card lifts by moving up (2 to 4px, plus a slight tilt when selected), not by gaining a hard edge.

## Shapes

Everything is a card or a chip. Corners step with size: 14px for stock panels and court cards (`card`), 12px for card faces, slots and inset boxes (`face`), 10px for buttons, tiles and wells (`control`), 8px for inputs, menu rows and banners (`sm`), 5 to 6px for tags and inline notes, and full pills for chips, meters and toasts.

The signature form is the printed inner frame: every card face (court card, item card, fan card) carries a 1.5px border inset 5px from its edge, at 45% opacity, inked in the card's owner colour (blue for the player, red for the boss, ink for neutral items, pale ink for unaffordable ones). Empty hand slots are dashed outlines (2px dashed `line`); filled slots become solid card faces.

## Components

### Buttons
Tactile and printed: solid fills, bold labels, a 1px press on active.
- **Shape:** gently rounded (10px), minimum 44px tall; small variant 36px; big variant 52px with the index face uppercase.
- **Primary:** Court Red fill, white label, primary glow; hover deepens to Red Ink. One primary per view: the action that advances the loop.
- **Quiet:** Stock 2 fill with a Line border on stock surfaces; hover Stock 3.
- **Ghost:** transparent with a 25% white border, for actions on baize (End run).
- **Danger:** Ink fill, white label (confirm dialogs). Red stays reserved for advancing the loop.
- **On colour:** Stock fill on a red or blue result panel.
- **Focus:** 3px Court Yellow outline, 2px offset. Disabled: 50% opacity.
- **Link:** Court Blue, bold, underlined at a 3px offset; on baize the link is yellow.

### Chips and Tags
- **Filter chip:** white pill, Line border, bold 0.875rem; selected is Ink fill with white text; hover darkens the border to Ink 3.
- **Status chips:** Dark (baize on baize, run status), Points (yellow), Pending (stock), and the ok / bad / warn state pairs with a court-ink border.
- **Tags:** 5px-cornered blocks, bold 0.78rem: blue for pierce, yellow for First Shot, red and ink for memory evidence and decisions.
- **Result chip:** pill in the index face, uppercase: blue Victory, red Defeat, yellow In progress.

### Cards / Containers
- **Stock panel:** Stock fill, 14px corners, Lift 1, 24px padding (16px on phones). Every section on baize is one of these.
- **Court card (fighter):** a stock panel with the printed inner frame in the owner's colour, a 56px left index column (large level numeral, LVL label, a crown for the boss), name and gear, large HP with a heart, then a ruled row of three Net stats (spade STR, diamond DEF, club DEX) with base values below.
- **Item card (Armory):** white face, 1.5px Line edge, 12px corners, at least 168px tall; name top left, cost as a large index numeral top right, family line, tags, then suit-pip modifiers at the foot. Hover lifts 3px; selected takes a 2px red ring and tilts -0.6deg; owned turns pale blue with "In hand" in place of the cost; unaffordable greys the name and cost and states "Need N more gold" in error ink.
- **Recessed well:** Stock 2 at 10px corners for summaries, predictions and fight totals.

### Inputs / Fields
- **Style:** white field, 1px Line border, 8px corners, 40px tall; number inputs use tabular figures; checkboxes are accented red.
- **Focus:** the global 3px yellow outline.

### Navigation
- **Top bar:** sticky, 60px, Baize 900 with a Baize 950 rule; the brand is a small white card with a red crown beside the uppercase index-face wordmark. Nav links are bold Atkinson in On-Baize 2; the current link turns On-Baize with a 3px yellow underline; Workshop opens a stock menu at Lift 2.
- **Phase tabs:** index-face uppercase tabs with rounded top corners, Baize 800 at rest, Stock when active so they merge into the panel below; disabled tabs at 40% opacity.

### Fight Log
The table's centre line: each attack is a two-sided row with a 1px Stock 3 rule down the middle; player attacks sit right-aligned on the left half, boss attacks left-aligned on the right half, each with a large damage numeral, the side name in its colour, and an HP meter for the defender (the player-side meter is mirrored). Rows deal in with a 6px drop and fade (320ms, `cubic-bezier(0.16, 1, 0.3, 1)`); a click reveals the dashed-rule calculation.

### The Boss's Hand (signature)
A baize inset holding the boss's equally strong plans as a fan of stock cards (132 x 184px; 82 x 106px compact in Prepare; 100 x 150px on phones), each rotated 5deg per step from a low pivot. Weaker plans are greyed and desaturated and marked "passed"; the played card stands upright, raised, and ringed in yellow with its draw probability as a red index numeral. A caption under the fan states what was played and why.

### Meters
8px pill tracks in Stock 3 with a fill in the owner's colour (blue player, red boss, yellow XP or neutral), animating width over 320ms.

## Do's and Don'ts

### Do:
- **Do** put every working surface on card stock (`stock`, 14px corners, Lift 1) laid on baize; put individual items on white card faces laid on that stock.
- **Do** keep blue for the player and red for the boss in every numeral, meter, log side and result.
- **Do** give every card face the printed inner frame (1.5px, inset 5px, 45% opacity, in the owner's ink).
- **Do** show stats with the authored SVG suit pips (heart HP, spade STR, diamond DEF, club DEX) with the text label alongside on first read.
- **Do** set compared numbers in Big Shoulders Display 800 with tabular figures, larger than their labels.
- **Do** size Armory-style grids from the 168px card module.
- **Do** use the 3px focus ring: yellow on baize, court blue on card stock and white faces (yellow is only ≈1.7:1 there). Yellow also marks "the one that was chosen".

### Don't:
- **Don't** colour the shell: no red, blue or yellow top bars, page grounds or panel fills (result panels and the played card are state, not shell).
- **Don't** put court-red or court-blue text directly on baize; use the on-baize tints or yellow.
- **Don't** use Unicode suit or icon glyphs; suits and icons are the authored SVG set.
- **Don't** use hard offset or black block shadows; depth is soft, baize-tinted lift.
- **Don't** set sentences in the index face or uppercase Atkinson body text.
- **Don't** drift toward the dark-parchment RPG panel or the grey dashboard.
