# Design

- Status: Accepted (Session 6)
- Date: 2026-09-25

The visual and interaction design of the client, and the reasoning behind it. The architecture decisions are in [decisions](decisions); this is their counterpart for what people see.

## Who it is for

A team estimates together on a video call, everyone on their own laptop. The facilitator shares their screen for the whole planning session, about two hours, switching between the issue tracker and the poker room. So the app has two audiences at once: each person's own screen, and the facilitator's screen, which everyone watches as compressed, downscaled video.

It should feel **calm and fast**: a precise tool that stays out of the way.

What follows from that:

- **Two layouts, chosen by window width.** People tile the app next to their call (compact) or give it a full window (wide). The window size is the choice, so there is no layout toggle.
- **Glanceable.** Attention is on the call. The screen answers "are we waiting on someone?" in one read.
- **Legible over a screen share.** The facilitator's view arrives as a small video thumbnail, so anything that carries meaning must survive downscaling.
- **Private on a shared screen.** The facilitator's own vote never appears on their screen before reveal, not even for a moment.

## Principles

- **Glanceable.** The status line answers the only question that matters mid-discussion, in one read.
- **One element, two jobs.** The deck is both the input and the result.
- **Calm by default.** Nothing moves because someone else acted, except the status text updating. The only motion is at reveal: names settle onto the scale once, in under 200 ms, and not at all with reduced motion.
- **Legible at thumbnail size.** Anything meaningful survives compressed, downscaled video.
- **Private on screen.** Before reveal, the facilitator view never shows the viewer's own vote.
- **Words do one job.** One name per action. Errors say what to do and never apologise.

## The memorable element: the deck is the scale

Before reveal, the deck row is where you choose. After reveal, the same row becomes the result: each person's name sits above the card they chose. Consensus is everyone stacked on one card; a wide spread visibly stretches across the deck. There is no separate results panel. This makes the reveal-time results decision visible: spread is measured in deck steps, and nothing is shown that does not map back to a card.

**Names sit above every card, numeric or not.** A sentence may add meaning, but it never replaces a name's place on the scale: "Cy voted ?" also appears as text, because a `?` usually means someone does not understand the story, and the facilitator should say so aloud.

## Tokens

Defined in [`src/web/styles/tokens.css`](../src/web/styles/tokens.css) as CSS custom properties. Each colour is defined once with its light and dark value through `light-dark()`, and `color-scheme` chooses between them.

### Colour

| Token   | Light     | Dark      | Job                                          | On Paper (light / dark) |
| ------- | --------- | --------- | -------------------------------------------- | ----------------------- |
| Paper   | `#F3F5F2` | `#141A20` | Background                                   | —                       |
| Ink     | `#1E2833` | `#E4E9EE` | Text, card numerals                          | 13.6 / 14.3             |
| Rule    | `#CDD5D1` | `#33404B` | Dividers, empty states                       | 1.4 / 1.7               |
| Edge    | `#7D8A92` | `#606B72` | Card outlines (control boundaries)           | 3.2 / 3.2               |
| Cobalt  | `#2D5BD8` | `#7FA2FF` | Your selection (a fill), focus ring, primary | 5.3 / 7.1               |
| Agree   | `#2F7D5B` | `#5FBF93` | Consensus                                    | 4.6 / 7.8               |
| Discuss | `#966319` | `#E0A84A` | Wide spread, outliers                        | 4.7 / 8.2               |

- **Colour is never the only signal.** Consensus and spread always have words; "voted" is a filled dot against a hollow one; "away" is a word.
- **Rule is decoration only:** dividers and empty states. At 1.4:1 it is too faint to survive a compressed screen share, and too faint to mark a control.
- **Card outlines use Edge.** The deck cards are buttons, and their outline is what makes them read as cards, so WCAG's non-text contrast criterion (1.4.11) requires 3:1 against the background. Rule cannot give that; Edge gives 3.2:1 in both themes.
- **Two contrast tiers, in both themes.** Meaning (text, and any colour that carries information) is at least 4.5:1 on Paper, WCAG AA for normal text. Control boundaries (Edge, and Cobalt as the focus ring) are at least 3:1. A test parses the stylesheet and enforces both, and checks that Rule stays below the control tier, so it cannot quietly stand in for Edge.
- **Discuss was darkened in the light theme,** from the brief's `#B7791F` to `#966319`: the same hue and saturation, lower lightness. The original was chosen by eye and never measured; at 3.3:1 it fails AA for the 16–18 px text it colours and would be the first thing to wash out over a screen share. At 4.7:1 it passes, and the test means the palette cannot slip below AA again.

### Themes

- A **System / Light / Dark** menu in the header, defaulting to System and remembered in `localStorage`.
- A `data-theme` attribute on `<html>` pins `color-scheme`, and so overrides `prefers-color-scheme`.
- **Known limitation:** each colour is defined once with `light-dark()`, which needs a 2024-or-later browser (Chrome 123, Firefox 120, Safari 17.5). Older browsers treat the colour tokens as invalid and fall back to their default black on white: readable, not broken. Accepted for a tool used in current browsers.
- **No flash of the wrong theme.** [`src/web/public/theme-init.js`](../src/web/public/theme-init.js) applies the stored choice before the first paint. It **must stay a plain, blocking `<script src>` in `<head>`: not `type="module"`, not `async`, not `defer`**, or the flash comes back. It is external rather than inline so that a Content-Security-Policy of `script-src 'self'` allows it with no hash to keep in sync. A test runs it and checks it applies exactly what the app would.

### Type

One family: **Atkinson Hyperlegible Next**, in weights 400 and 700. It was designed for legibility, with numerals that cannot be confused (1/7, 3/8, 5/6), which matters for numbers read at a glance, in a small window, or through compressed video.

- **Self-hosted**, with no third-party request: it works offline and avoids the GDPR concerns of loading fonts from a third party's servers. The variable font covers both weights in one file per subset: Latin (34 KB) always, and Latin Extended (19 KB) only when a name on screen needs one of its characters (`unicode-range`).
- The files are the upstream Fontsource 5.3.0 builds of the Google Fonts release, **used exactly as published: never subset or altered here**. They are licensed under the SIL Open Font License 1.1 ([`src/web/fonts/OFL.txt`](../src/web/fonts/OFL.txt)), which declares no Reserved Font Name.
- **Sentence case everywhere.** No all-caps labels.

| Role               | Compact     | Wide        |
| ------------------ | ----------- | ----------- |
| Body               | 16 px / 400 | 18 px / 400 |
| Status line        | 18 px / 700 | 22 px / 700 |
| Card numerals      | 28 px / 700 | 40 px / 700 |
| Names on the scale | 16 px / 700 | 18 px / 700 |
| Room heading       | 20 px / 700 | 24 px / 700 |

Sizes are in `rem`, so browser zoom scales them. The wide sizes are set for a 1080p screen share seen as a thumbnail: if a name is hard to read in a small video-call tile, it is too small.

## Layout

- **One component tree.** Compact and wide are switched by CSS grid areas at `55em` (880 px). There is no duplicated markup, and the reading order for keyboards and screen readers is the same in both.
- **Left-aligned text.** Sections are separated by space, not wrapped in boxes. Only the deck cards have outlines, because they are cards.
- **Participants keep join order** and never reshuffle.
- **The title is "Planning poker".** Rooms have no names yet ([#35](https://github.com/ekutnik/planning-poker/issues/35)), and the room id is never shown in its place: it is the room's credential, and the facilitator's screen is shared, possibly recorded, for the whole session.

Compact, participant view, voting:

```
┌──────────────────────────────────┐
│ Planning poker                   │
│ Facilitate ○  Theme              │
│ Copy link  Leave                 │
│                                  │
│ 4 of 5 have voted                │
│ ● Ada  ● Ben  ○ Cy  ● Dee        │
│ ● Eli  ○ Fay (away)              │
│                                  │
│ ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐ │
│ │0 ││1 ││2 ││3 ││5 ││8 ││13││21│ │
│ └──┘└──┘└──┘└──┘└──┘└▀▀┘└──┘└──┘ │  your 8: a Cobalt fill
│ ┌──┐┌──┐                         │
│ │? ││☕│                          │
│ └──┘└──┘                         │
│ Reveal votes                     │  secondary button
└──────────────────────────────────┘
```

Wide, facilitator view, voting (what the team sees on the shared screen):

```
┌──────────────────────────────────────────────────────────────┐
│ Planning poker       Facilitate ●   Theme   Copy link   Leave │
│                                                              │
│ Waiting for Cy. Fay is away.            [ Reveal votes ]     │
│                                         1 hasn't voted       │
│ ● Ada           ┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐     │
│ ● Ben           │ 0 ││ 1 ││ 2 ││ 3 ││ 5 ││ 8 ││13 ││21 │     │
│ ○ Cy            └───┘└───┘└───┘└───┘└───┘└───┘└───┘└───┘     │
│ ● Dee           ┌───┐┌───┐                                   │
│ ● Eli           │ ? ││ ☕│    no card shown as selected       │
│ ○ Fay (away)    └───┘└───┘                                   │
│                                                              │
│                 Your vote (hidden)  [ •• ]   You've voted ✓   │
└──────────────────────────────────────────────────────────────┘
```

Wide, revealed. The same deck row becomes the scale:

```
┌──────────────────────────────────────────────────────────────┐
│ Votes revealed                        [ Start next round ]   │
│                                                              │
│                           Dee                                │
│                 Ada       Ben  Eli         Cy                │
│  0    1    2    3    5    8    13    21    ?    ☕           │
│                                                              │
│ Spread of 3 steps, from 3 to 13.                             │  Discuss colour
│ Ada and Eli, talk through your estimates.                    │
│ Cy voted ?                                                   │
└──────────────────────────────────────────────────────────────┘
```

## Who the round waits for

**People who are away and have not voted do not hold up the round:** the status line counts everyone connected plus anyone away who has voted, and lists the away non-voters separately ("Waiting for Cy. Fay is away."; "Everyone has voted. Fay is away."; "4 of 5 have voted"). Nobody waits on a closed laptop. Grace removal still keeps an away participant's seat for 60 seconds, so if they come back and vote, they count again. This is purely how the snapshot is presented; the server does not change. It is a plain, tested view function.

## The facilitator view

A per-person view, not a role, so the server does not change and anyone can still reveal and reset ([ADR 0005](decisions/0005-anyone-can-reveal.md)).

- **The toggle.** A "Facilitate" switch in the header with `aria-pressed`, remembered per browser in `localStorage`, because the same person usually runs every session. Its description reads: "Shows the round controls up front and hides your own vote, so you can share your screen."
- **Controls up front.** "Reveal votes", then "Start next round", as the primary action, always in the same place: top of the main area in wide, pinned to the bottom in compact. In the participant view the same controls are quieter secondary buttons.
- **The controls come last in the DOM,** after the hidden vote. In compact that matches the pinned bar; in wide they sit top right but come last in keyboard order, which still follows the task (read the status, see who is in, vote, then reveal): WCAG asks for a meaningful focus order, not a strictly visual one.
- **The status line names who is missing** ("Waiting for Cy. Fay is away.") rather than counting, because that is what the facilitator says aloud. When everyone counted has voted it reads "Everyone has voted", with any away non-voters after it ("Everyone has voted. Fay is away.").
- **No confirmation on reveal.** "1 hasn't voted" sits beside the button instead. A calm, fast tool does not add friction.
- **Per browser, so design for the surprise.** Someone who facilitated yesterday may join as a participant today, click a card, and see no selection. The toggle's visible state in the header and the "You've voted ✓" line must make it obvious they are in the facilitator view.

**Hidden vote, before reveal:**

- No card shows as selected, visually or in accessibility state. The deck looks and reads the same whether they have voted or not.
- Confirmation carries no value: "You've voted ✓", never the card.
- "Clear my vote" says nothing about what is being cleared.

**The masked field,** the leak-free way to vote, because the cursor moving to a card is visible on a shared screen:

- Labelled "Your vote (hidden)". Type 13 and press Enter. It accepts every deck value, plus `?`, and `c` for ☕. The field clears after each vote, and the confirmation is "Vote recorded".
- Errors never echo the input: "Not a card on the deck", never "4 is not a card".
- Masked with `-webkit-text-security` on a text field, because a password field invites password managers. That property is non-standard, and where it is missing the field would show "13" on the shared screen with no error, so the app checks `CSS.supports("-webkit-text-security", "disc")` once and falls back to `type="password"`.
- Keep password managers out: no `<form>` (Enter is handled directly), `autocomplete="off"`, `spellcheck="false"`, and a manual check in Chrome, Safari and Firefox for "Save password?" prompts.
- Clicking a card still works in the facilitator view, for anyone who does not mind the cursor being seen.

## Copy

Each action keeps one name through the whole flow.

| Moment                | Copy                                                                         |
| --------------------- | ---------------------------------------------------------------------------- |
| Status (participant)  | "4 of 5 have voted", or "Everyone has voted"                                 |
| Status (facilitator)  | "Waiting for Cy. Fay is away.", or "Everyone has voted. Fay is away."        |
| Primary actions       | "Reveal votes" → "Votes revealed"; "Start next round"                        |
| Own vote, facilitator | "You've voted ✓"; "Vote recorded"; "Clear my vote"                           |
| Consensus             | "Everyone chose 5."                                                          |
| Close spread          | "Close: 3 and 5."                                                            |
| Wide spread           | "Spread of 3 steps, from 3 to 13. Ada and Eli, talk through your estimates." |
| No numeric votes      | "No numeric votes this round."                                               |
| Non-numeric votes     | "Cy voted ?"                                                                 |
| Link                  | "Copy link" → "Link copied"                                                  |
| Invalid masked entry  | "Not a card on the deck"                                                     |

## Accessibility, built in

- **The deck is a toolbar of toggle buttons** (`aria-pressed`), not a radiogroup: a radiogroup selects on arrow keys, which here would cast and broadcast a vote on every keypress. Arrow keys move between cards, Space or Enter chooses, and Tab moves past the whole deck in one step.
- **Reveal is announced** through a polite live region: "Votes revealed. Everyone chose 5", or "Spread of 3 steps. Ada and Eli, talk through your estimates."
- **The voted count is visible but not announced** on every change, which would make a screen reader chatter through the whole discussion.
- **Selection and focus look different,** so a keyboard user can tell "this is my vote" from "this is where I am". Selected: a Cobalt fill with the numeral in Paper (5.3:1 light, 7.1:1 dark). Focused: the 3 px Cobalt ring, 2 px outside the card's edge. A selected card with focus shows both. In the facilitator view before reveal, "selected" never appears, so only focus does.
- **Every control shows the focus ring** when reached from the keyboard.
- **"Away" is a word,** not only a dimmed name.

Session 7 audits what is built in; it is not a retrofit. It needs a browser, and covers:

- A screen reader pass, and keyboard only, in both layouts and both themes.
- **Focus order is meaningful in both layouts.** One component tree keeps the DOM order identical by construction; the real risk is CSS grid areas reordering the picture without reordering the DOM, so focus jumps around the screen. The one deliberate difference is the wide facilitator controls (see the facilitator view).
- **200% zoom,** including that the pinned facilitator bar in the compact layout never covers the deck: a sticky bar is a common way for a zoomed page to become unusable.

## Reviewed against the brief

| First instinct                       | Changed to                                             | Why                                                                                               |
| ------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Card-flip animation on reveal        | Names settle onto the scale once                       | Flipping is the stock planning-poker effect, the drama this rejects. Settling shows what changed. |
| A results card with big stat numbers | Results on the deck itself, plus one sentence          | Big stat tiles are the dashboard default, and the results model has no median.                    |
| A blueprint-blue background          | Quiet paper; the drafting idea lives only in the scale | Too literal and too loud for "calm".                                                              |
| Every section in a rounded box       | Space between sections; only the cards are outlined    | The generic card kit.                                                                             |
| A single narrow column               | Two layouts, switched by width                         | A full desktop window deserves the width; the scale benefits most.                                |
| Sizes chosen for one person's screen | Wide sizes chosen for a screen-share thumbnail         | The facilitator's screen is the team's shared view.                                               |
| A highlighted own vote everywhere    | Hidden in the facilitator view, plus the masked field  | A shared screen broadcasts it, and the cursor leaks a click.                                      |

## Tests that prove the properties

- **Screen-level no-leak test,** mirroring the wire-level vote-privacy test: in the facilitator view before reveal, no element shows the viewer's own card (no selected state on any deck card, no card value in any visible text, and the masked field empty after submit). Removing the hiding once must fail it.
- **Invalid masked input** produces the fixed error copy, never containing the typed value.
- **Masking fallback:** the no-leak test runs in a browser with and without `-webkit-text-security`, and expects a text field or a password field accordingly.
- **Theme:** the no-flash script applies exactly what the app would, for every stored value (unit test); the stored choice is applied before first paint (the Session 8 end-to-end suite).
- **Contrast, two tiers, both themes:** meaning (Ink, Cobalt, Agree, Discuss) at least 4.5:1 on Paper; control boundaries (Edge, Cobalt) at least 3:1; Rule below 3:1, so it cannot stand in for Edge; and a Paper numeral on a Cobalt fill at least 4.5:1.
- Focus order and 200% zoom need a browser, so they belong to the Session 7 audit above.
