# Draw Steel: Combat Tools

[![Downloads](https://img.shields.io/github/downloads/TheGenieOfTheCode/draw-steel-combat-tools/total?label=Downloads&color=4aa94a)](https://github.com/TheGenieOfTheCode/draw-steel-combat-tools/releases)
[![Latest Version](https://img.shields.io/github/downloads/TheGenieOfTheCode/draw-steel-combat-tools/latest/total?label=Latest%20Version&color=4aa94a)](https://github.com/TheGenieOfTheCode/draw-steel-combat-tools/releases/latest)

*Bringing the rules of Draw Steel to Foundry, one ability at a time.*

A Foundry VTT module for the Draw Steel system that automates and streamlines the combat mechanics of Draw Steel. Each feature is individually toggleable, so you can use as much or as little as fits your table.

**Requires Foundry v14 and the Draw Steel system.**

---

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/genieofthecode)

*If you like what I do, consider donating on Ko-fi. Thanks!*

---

## Recommended Modules

**From the Combat Tools family**

- [Draw Steel: Death Tracker](https://github.com/TheGenieOfTheCode/draw-steel-death-tracker) keeps track of who falls: deaths announced in chat with an undo, the right minions taken from a squad, and the fallen left where they fell.
- [Draw Steel: Battle Log](https://github.com/TheGenieOfTheCode/draw-steel-battle-log) draws each turn, round and fight into the chat log and folds away what's finished, and makes the chat cards match the dark theme.

**Also recommended**

- [Draw Steel - Encounter Builder](https://foundryvtt.com/packages/draw-steel-encounter-builder) to build encounters to budget.
- [Draw Steel - Resources UI](https://foundryvtt.com/packages/draw-steel-resources-ui) puts all of the resource gain and spend in one place.
- [Draw Steel - Hideout](https://foundryvtt.com/packages/draw-steel-hideout) makes Downtime and projects easier to run.
- [Hand Drawn Tokens for Draw Steel by Max Hamm](https://foundryvtt.com/packages/ds-tokens-max-hamm) for token art for Draw Steel monsters.
- [Visual Active Effects](https://foundryvtt.com/packages/visual-active-effects) makes conditions and effects easier to read and toggle.
- [Z Scatter](https://foundryvtt.com/packages/z-scatter) for features where creatures share a space.
- [Smart Target](https://foundryvtt.com/packages/smarttarget) for targeting by keyboard, an alternative to the Combat Tools pickers.

---

## Documentation

Full documentation is available on the **[Wiki](https://github.com/TheGenieOfTheCode/draw-steel-combat-tools/wiki)**.

---

## Features

**[Party Tools](https://github.com/TheGenieOfTheCode/draw-steel-combat-tools/wiki/Party-Tools)**: An Overview tab on the party sheet shows the group's skills, languages and characteristics at a glance, and carries into the advancement picker while players choose.

**[Triggered Actions](https://github.com/TheGenieOfTheCode/draw-steel-combat-tools/wiki/Triggered-Actions)**: Every creature's triggered action resets each round, with a badge on its token showing whether it's still available.

**[Teleportation](https://github.com/TheGenieOfTheCode/draw-steel-combat-tools/wiki/Teleport)**: Teleport to a free square, swap places with another token, or land next to one, with a canvas picker and an undo.

**[Ability Areas](https://github.com/TheGenieOfTheCode/draw-steel-combat-tools/wiki/Ability-Areas-and-Regions)**: Give an ability's area a colour, a lifetime, and something it does to whoever stands in it.

**[Wall Builder](https://github.com/TheGenieOfTheCode/draw-steel-combat-tools/wiki/Wall-Builder)**: Create, convert, and manage destructible walls with material rules and a live canvas overlay.

**[Conditions](https://github.com/TheGenieOfTheCode/draw-steel-combat-tools/wiki/Damage-and-Conditions-Panel)**: Apply damage and conditions to multiple targets from a single panel. Includes Grab, Frightened (with source ping), Taunted, and Bleeding auto-apply.

**[Flat Effects](https://github.com/TheGenieOfTheCode/draw-steel-combat-tools/wiki/Flat-Effects)**: Damage, forced movement, conditions, healing and teleports that happen without a power roll, as buttons on the ability's chat message.

**[Squads](https://github.com/TheGenieOfTheCode/draw-steel-combat-tools/wiki/Squad-Labels)**: Squads are numbered at combat start and renumbered as they change, share one floating Stamina bar, take their turn together, and strike as one with a signature ability. A new captain steps up when the old one falls.

**[Stealth and Cover](https://github.com/TheGenieOfTheCode/draw-steel-combat-tools/wiki/Stealth-Overview)**: Who is hidden from whom, searching and being found, and cover and concealment judged by the lines you can draw to a target's corners.

**[Ability Automation](https://github.com/TheGenieOfTheCode/draw-steel-combat-tools/wiki/Visible-Modifiers)**: Every edge, bane and bonus shown by name in the roll and in chat, a target picker for untargeted rolls, and ready made enhanced abilities, from Judgement and Mark to Hesitation Is Weakness.

**[Forced Movement](https://github.com/TheGenieOfTheCode/draw-steel-combat-tools/wiki/Overview)**: Push, pull, and slide tokens with full collision detection, a visual arrow preview, vertical movement, fall confirmation, and an undo system.

---

## Installation

Install via the Foundry module browser, or paste this manifest URL directly:

```
https://github.com/TheGenieOfTheCode/draw-steel-combat-tools/releases/latest/download/module.json
```

**Required dependencies:** [socketlib](https://foundryvtt.com/packages/socketlib), [color-picker](https://foundryvtt.com/packages/color-picker), [lib-wrapper](https://foundryvtt.com/packages/lib-wrapper), [Draw Steel: Target Damage](https://foundryvtt.com/packages/draw-steel-target-damage), [Draw Steel: CTLib](https://github.com/TheGenieOfTheCode/draw-steel-ctlib)

Foundry offers to install all five alongside DSCT. They are requirements rather than suggestions: most of the module either patches something through libWrapper or presents itself inside the Target Damage panel, and CTLib holds the code the Combat Tools modules share.

---

## Compatibility

- [Tagger](https://foundryvtt.com/packages/tagger): Wall Builder tags the walls it makes through Tagger.
- [DS Terrain Designer](https://foundryvtt.com/packages/ds-terrain-designer): forced movement follows the terrain’s slopes and heights, and High Ground uses its edges.
- [DS Token Override](https://github.com/nelizzy/ds-token-override): a squad’s Stamina bar follows its Squad Threshold Marks setting, and doubled up health labels are hidden.
- [Draw Steel - Combat Tracker](https://foundryvtt.com/packages/draw-steel-combat-tracker): every minion of a squad shows as able to act during the squad’s turn.
- [Draw Steel - Ability HUD](https://foundryvtt.com/packages/draw-steel-ability-hud): the HUD’s triggered action button follows the tracker here, for everyone at the table.
- [Health Estimate](https://github.com/mclemente/healthEstimate): what it shows for a minion in a squad follows the Minion Health Estimate Display setting.
- [Draw Steel Plus](https://github.com/featureJosh/draw-steel-plus) works with this module, but newer features here aren’t fitted to its restyled sheets and messages, and keeping up with it isn’t a priority.

---

## Issues & Feedback

Bug reports and feature requests go in [Issues](https://github.com/TheGenieOfTheCode/draw-steel-combat-tools/issues).
