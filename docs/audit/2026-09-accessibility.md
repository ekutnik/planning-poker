# Accessibility and robustness audit, September 2026

Session 7. The standard is WCAG 2.2 AA, with three criteria that bear directly on this app: 2.4.11 Focus Not Obscured, 2.5.8 Target Size, and 1.4.10 Reflow. The audit checks every claim in [design.md](../design.md) and runs real tasks rather than a checklist. Every finding ends as a fix, an issue, or a written acceptance.

**Status: complete (2026-09-26); before-launch re-checks tracked in [#44](https://github.com/ekutnik/planning-poker/issues/44).** Six findings, A-01 to A-06, all fixed. Three checks still need a person before the link goes public: VoiceOver on the empty cards of the scale, VoiceOver on the reveal announcement after the A-06 fix, and the Firefox masked field; see [Checks by hand](#checks-by-hand) and the re-check table.

## Environment

| Tool                                                       | Used for                                                                  | Status                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------- |
| Chromium (the Claude desktop app's browser), keyboard only | Every flow without a mouse, focus order and visibility                    | Done, 2026-09-26                      |
| Chromium, viewport emulation                               | Reflow and zoom: 640×400 is 200% and 320×200 is 400% of a 1280×800 window | Done, 2026-09-26                      |
| Chromium, scripted measurements                            | Target sizes, focus hidden by the pinned bar, text spacing (1.4.12)       | Done, 2026-09-26                      |
| Chromium accessibility tree                                | Roles, names, headings, landmarks, live regions                           | Done, 2026-09-26                      |
| VoiceOver with Safari                                      | The main screen reader pass                                               | By hand, 2026-09-26; one item not run |
| Firefox                                                    | The masked field and password prompts                                     | Not run; before launch (#44)          |
| axe                                                        | An automated baseline on every screen                                     | Not run; see below                    |
| A real Meet or Zoom share, viewed on a second device       | Legibility at thumbnail and full size, both themes                        | By hand, 2026-09-26                   |

**Versions:** the latest macOS, Safari and Chrome on 2026-09-26; exact version numbers were not noted.

**Not covered:** NVDA and JAWS on Windows, and mobile screen readers (VoiceOver on iOS, TalkBack). **axe was not run:** the extension was not installed, and loading the engine into the page was not approved for this pass; Session 8 adds it as a dev dependency, run by Playwright on every CI build, so its baseline arrives there. Browser zoom was emulated with viewport sizes, which gives the same CSS-pixel viewport as real zoom; a real 400% zoom in Chrome is part of the re-check. The accessibility tree seen from Chromium is what a screen reader is given, not what it says: the inspection tool even drops two-letter names ("Cy", "Zo") that the DOM has, so it cannot stand in for the VoiceOver pass.

## Scenarios

| #   | Scenario                                                                     | Keyboard (Chromium)                                                                                                          | By hand, 2026-09-26          | Findings         |
| --- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------- |
| 1   | Create a room, join from a second browser, vote                              | Done: create with Enter from the name field; join by link; vote with arrows and Space                                        | VoiceOver: completed         | A-01, A-02, A-03 |
| 2   | Run a round as facilitator: masked vote, reveal, read the result, next round | Done: every step by keyboard, focus visible at each stop, focus to the status line after reveal and after "Start next round" | VoiceOver: completed         | A-01, A-04, A-06 |
| 3   | Someone else reveals and starts the next round while you listen              | Live region text checked: "Votes revealed. Close: 8 and 13." and "Next round started."                                       | VoiceOver: completed         | None             |
| 4   | Every reachable stopped screen, plus "Not a room"                            | Done for "left", "open in another tab" and "Not a room"                                                                      | VoiceOver: completed         | A-02             |
| 5   | Scenarios 1 and 2 at 200% and 400%, compact and wide                         | Done at 640×400 and 320×200, facilitator view, voting and revealed                                                           | n/a                          | A-05             |
| 6   | Screen share of the facilitator view, voting and revealed, both themes       | n/a                                                                                                                          | Readable at thumbnail size   | None             |
| 7   | The masked field in Firefox                                                  | n/a                                                                                                                          | Not run; before launch (#44) | None             |
| 8   | Theme: Dark, reload, second tab                                              | Script order checked in the built page; tab sync checked after #41                                                           | No flash on reload           | None             |

## Findings

### A-01 The room has no headings

- **Where:** scenarios 1 and 2; the room, voting and revealed, both views.
- **What happened:** the room screen has no heading elements at all. The status line ("Waiting for Cy. Fay is away.", "Votes revealed") is set as the screen's heading, bold and larger, but it is a paragraph. A screen reader user cannot jump to it by heading, and gets no outline of the page. Every other screen has one `h1`.
- **Expected:** the status line is the room's heading.
- **WCAG:** 1.3.1 Info and Relationships (a visual heading not marked up as one).
- **Severity:** Major.
- **Decision:** fix. The status line becomes the room's `h1`; it already takes focus after a phase change. Its text changes as people vote, which is fine for a heading: it is not a live region and must not become one, so it never chatters. Whether the people list and the deck also need `h2` headings was left to the VoiceOver pass, which reported nothing that asked for them, so none are added now.

### A-02 Screen changes are silent, and focus falls to the page

- **Where:** scenarios 1 and 4. After "Create a room" or "Join", the room replaces the form; after Leave, or when another tab or a new version stops the room, a stopped screen replaces the room.
- **What happened:** focus falls to `<body>` and nothing is announced. For the stopped screens that arrive on their own (another tab took over, a new version, the room is full), a screen reader user is not told the room has stopped at all.
- **Expected:** the new screen's heading takes focus when focus was lost, the same rule as after a phase change, so a screen reader reads where you are and the keyboard starts from there.
- **WCAG:** 2.4.3 Focus Order; 4.1.3 Status Messages for the stops nobody asked for.
- **Severity:** Major.
- **Decision:** fix, with one rule for phase changes, joins and stops: when focus is lost, the new screen's heading takes it. A normal first page load is left to the browser. VoiceOver confirms before and after.

### A-03 Every screen has the same title

- **Where:** scenario 1; every screen.
- **What happened:** the document title is "Planning poker" on the landing page, in a room, and on every stopped screen.
- **Expected:** a title per screen, such as "Votes revealed · Planning poker" or "You left the room · Planning poker". Never the room id, which is the room's credential.
- **WCAG:** 2.4.2 Page Titled.
- **Severity:** Minor, under 30 minutes.
- **Decision:** fix, in the same PR as A-02, and in the room the title carries the round status: "2 waiting · Planning poker", "Everyone voted · Planning poker", "Votes revealed · Planning poker". A facilitator switching between the issue tracker's tabs can see whether everyone has voted without switching back. It shows only public information: never a vote, never the room id. Screen readers do not announce title changes, so it stays calm.

### A-04 Long names on the wide scale break mid-word and read as more people

- **Where:** scenario 2, wide revealed, both views; worse on a screen share.
- **What happened:** a scale column is about 65 px wide at 1280 px. "Ada Lovelace" wraps into "Ada / Lovelace", which reads as two people stacked on the card. With `overflow-wrap: anywhere`, "Bartholomew Montgomery" breaks into "Barthol / omew / Montgo / mery". The people list beside it shows the names whole.
- **Expected:** each name is visibly one name. design.md: "each person's name sits above the card they chose."
- **WCAG:** none directly; it contradicts design.md and misleads in real use.
- **Severity:** Major (the result is misread).
- **Decision:** fix with CSS alone: one line per name (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`). The truncation is only visual; the full name stays in the page, so a screen reader reads it with no extra hidden text.
- **Accepted:** two long names that share a start ("Barthol…") can look alike on the scale. The people list beside it shows every full name with its card.

### A-05 At 400% zoom the pinned bar takes a third of the screen

- **Where:** scenario 5, facilitator view at 320×200.
- **What happened:** the pinned controls bar is 68 of 200 px high and never scrolls away. Nothing focused is hidden behind it (2.4.11 passes), and nothing scrolls sideways (1.4.10 passes), but a third of the viewport is always the bar.
- **Expected:** at very short viewports the bar scrolls with the page, as it does in wide.
- **WCAG:** none failed.
- **Severity:** Minor, under 30 minutes.
- **Decision:** fix, though no WCAG criterion failed: the bar is pinned only above a minimum viewport height (a `min-height` media query) and sits in the normal flow below it. A Minor under 30 minutes is fixed rather than filed.

### A-06 "Votes revealed" is heard twice by the person who reveals

- **Where:** scenario 2, VoiceOver with Safari, the person who presses Reveal.
- **What happened:** "Votes revealed" is heard twice: once as the heading that takes focus (A-02's rule, since the Reveal button went with the voting view), then again at the start of the live announcement, before the result.
- **Expected:** heard once. Everyone else, whose focus stays put, hears it once, from the announcement.
- **WCAG:** none failed.
- **Severity:** Minor (noise).
- **Decision:** fix. Decided after focus moves, not predicted before: the new heading's effect reports whether it took focus, and only then is the live region's text chosen, by one pure function, `announcementFor(tookFocus, copy)`: the result alone if the heading took focus, the whole announcement if not.

## Checked, no finding

- **Keyboard only, scenarios 1 and 2:** every flow completes without a mouse; no traps; the focus ring shows at every stop (`:focus-visible` matched for each).
- **Focus order** follows the task in both layouts: header, deck, hidden vote, Clear, then Reveal.
- **The Tab stop after a mouse click** returns to the first card once focus leaves the deck (checked 2026-09-25 while building #38).
- **Selection and focus look different:** a selected, focused card shows the Cobalt fill and the 3 px ring 2 px outside it.
- **2.5.8 Target Size:** every control is at least 24×24 CSS px at every size checked. The smallest is the Theme menu, 80×27.
- **1.4.10 Reflow:** no sideways scrolling at 320 px on the landing page, the room (both phases, facilitator view), and "Not a room".
- **2.4.11 Focus Not Obscured:** every control focused at 640×400 and 320×200 ends clear of the pinned bar (0% hidden).
- **1.4.12 Text Spacing:** with the criterion's spacing applied, nothing clips, compact or wide.
- **No flash of the wrong theme:** in the built page the blocking `theme-init.js` runs before the stylesheet and the body.
- **Theme sync across tabs (#41):** a choice in one tab applies in the other, both ways, including the menu's value.
- **Live region text:** "Votes revealed. …" at reveal and "Next round started." at the next round, each set once. Heard with VoiceOver; for the person who pressed Reveal, "Votes revealed" comes twice (A-06).

## Checks by hand

Run by the maintainer on 2026-09-26, with the latest macOS, Safari and Chrome. One line per check, as observed; anything not observed in detail is marked "Not run" and is due before launch in [#44](https://github.com/ekutnik/planning-poker/issues/44).

| Check                                 | Result                                                                                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VoiceOver, scenarios 1 to 4           | Completed: create, join, vote, reveal, next round, and the stopped screens reachable by hand.                                                                                                                              |
| VoiceOver, after pressing Reveal      | "Votes revealed" heard twice: once from the heading that takes focus, once at the start of the announcement. Finding A-06.                                                                                                 |
| VoiceOver, empty cards on the scale   | Not run. How the cards nobody chose are read is unknown; due before launch (#44).                                                                                                                                          |
| VoiceOver, the same masked vote twice | "Vote recorded" announced again the second time.                                                                                                                                                                           |
| Firefox, the masked field             | Not run; due before launch (#44). The field is masked on either path by construction (CSS where supported, `type="password"` otherwise; both unit-tested), so what remains open is a password prompt on the fallback path. |
| A real screen share                   | Everything readable on a second device at thumbnail size: status line, names, numerals and the result sentence, both themes, voting and revealed.                                                                          |
| Theme, Dark then several reloads      | No flash of the light theme.                                                                                                                                                                                               |

## Re-check after fixes

Each finding re-checked the way it was found.

| Finding | Fixed in | Re-check                                                                                                                                                                                                                                                                                                                                                                                                 | Result                            |
| ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| A-01    | #43      | Chromium, 2026-09-26: the room has exactly one heading, the `h1` status line, in both phases; it has no live-region role                                                                                                                                                                                                                                                                                 | Verified                          |
| A-02    | #43      | Chromium, keyboard, 2026-09-26: after "Create a room", focus is on the room's `h1`; after Enter on Reveal, on "Votes revealed"; after Leave, on "You left the room."; with focus on "Start next round", opening the room in another tab moves focus to "This room is open in another tab."; a fresh load of a room or "Not a room" leaves focus on the page                                              | Verified                          |
| A-03    | #43      | Chromium, 2026-09-26: the tab title went "1 waiting", "Everyone voted", "Votes revealed", then "You left the room", each followed by " – Planning poker"; "Not a room" and "This room is open in another tab" titled likewise; no vote or room id in any title                                                                                                                                           | Verified                          |
| A-04    | #45      | Chromium, 2026-09-26, wide 1280×800 revealed, with "Bartholomew Montgomery", "Barthold Mountbatten" and "Ada Lovelace": every scale name is one line (27 px, the line height), long ones end in "…", no sideways scroll; screen readers get the full text                                                                                                                                                | Verified                          |
| A-05    | #45      | Chromium, 2026-09-26: at 320×200 the bar sits in the normal flow and the scroll padding is off; at 640×400 and 375×812 it is pinned with its 76 px scroll padding; wide is unchanged                                                                                                                                                                                                                     | Verified                          |
| A-06    | #45      | Chromium, 2026-09-26: pressing Reveal from the keyboard puts focus on "Votes revealed", and the live region changes once, to "Close: 3 and 5. Cy voted question mark."; with focus on Copy link while someone else reveals, it changes once, to "Votes revealed. Only Gus voted: 8." VoiceOver re-check (is the result still heard after the heading, not cut off?) not yet done: due before launch, #44 | Fixed; VoiceOver re-check pending |

A note on the A-04 re-check: columns are about 82 px wide at 1280 px, so a common two-word name is cut too ("Ada Lov…"), not only very long ones. Nothing is misread, and the people list shows every full name, but it is a candidate for the Session 7b visual pass (for example, first names on the scale).

A note on the A-02 re-check: focusing an element from a script, in a tab without window focus, fires no `focusin`, so the page cannot know focus was ever there, and nothing is recovered. That is a test artefact, not a user path: real key presses and clicks give the window focus. Safari does not focus a button on click, so a mouse-only Safari user never had focus in the page, which is the same as a fresh load: focus stays with the browser.
