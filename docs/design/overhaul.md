> **Note, 2026-10-22.** The "cyan = shield" damage-number colour below is
> superseded. The design gate's six-token palette (CLAUDE.md, "Design: the
> battle screen") allows no seventh colour, and the owner's ruling on phase
> two's gate (R6) made a shield a shape: the shield glyph drawn in `--card`.
> The record's body is left as it was written.

# Designing "The Orrery" Raid: Combat, Roles, Boss Mechanics and Legibility Principles from FFXIV, WoW, FFX and Turn-Based Classics

The overhaul should make the turn-order strip the main place where the fight happens, not just a display: every role gets one action that changes the strip (moves someone up, pushes the boss back, links turns together, or reveals the boss's next move), and every boss mechanic shows up on the strip before it resolves. The research below supports this. The best-documented systems in the reference games (FFX's action Rank, Persona/SMT's extra-turn economies, Octopath's Break, Slay the Spire and Into the Breach's telegraphed intents, WoW and FFXIV's role-gated raid checks) all work because players can see something coming and spend their turn answering it.

## TL;DR
- **Give each role one strip-changing action, and make roles depend on each other through shared group mechanics.** Each archetype gets a unique resource and one action that manipulates the CTB timeline. Group mechanics (a Break meter, a visible Chain multiplier for consecutive player turns, Exposed stacks one player sets up and another spends) make 4 different roles worth more than 4 copies of one. Weakness hits that cut your wait time are FFX Rank plus SMT Press Turn, and they fit a CTB counter system natively.
- **Make the Orrery a telegraph machine.** Every big attack appears on the strip as a boss card with a countdown and an intent icon. Answers are role-gated (Warden intercepts, Mender wards, Chronist delays, Breaker shatters shields) and depend on squad composition, not headcount. Three HP-threshold phases end in a visible "Grand Alignment" enrage clock.
- **For 12–40 people, split the room into squads and keep turns moving.** Use squads of 4–6 (like FFXIV's three parties of eight) that each own a sub-mechanic, a per-turn decision timer with an auto-Brace fallback for idle players, and Jackbox-style late joining where newcomers enter at the back of the strip. Show every action on the battlefield first (anticipation → impact → follow-through, hit-stop, damage-number styling), and only then in the log.

## Key Findings (established practice, cited)

### 1. Interesting decisions are situational and must have visible consequences
- Sid Meier's GDC 2012 talk "Interesting Decisions" grew from his GDC 1989 line that "a game is a series of interesting decisions." His main point: "Good decisions are situational… when the decision is presented to the player, ideally it acts in an interesting way with the game situation."\[1\] He also warned that "something that's interesting you do once doesn't mean it's something interesting to do ten times."\[2\] The current Strike/Brace loop fails this test: nothing in the situation changes which button is right.
- In "Interesting Decisions in Games" (LinkedIn), former Slipgate Ironworks studio game director Jannick Hynding Lund summarises the talk: "the most important factor is that interesting decisions must have interesting consequences," and "it's not an interesting decision if all players choose B… then the game might as well not give them the choice."

### 2. CTB (FFX) already contains a speed-vs-power trade-off
- In FFX each action has a Rank that sets the recovery delay. Attack and most abilities are Rank 3, items and Defend are Rank 2, switching equipment or fleeing is Rank 1. Delay scales directly with Rank: "a rank 4 action results in twice as much delay as a rank 2 action." Haste halves delay and Slow doubles it. A revived character re-enters "as if they had just used a rank 3 action."\[3\]
- The Final Fantasy Wiki says CTB "does not operate in rounds… weaker abilities tend to require less cool down time, thus introducing a trade-off between speed and power."\[4\] Giant Bomb notes the key legibility feature: when you highlight an action, the turn list previews how it will change the turn order.\[5\]
- **Implication:** your formula (tickSpeed × actionRank × hasteMultiplier) is FFX's model. The missing piece is a *preview*: hovering a command should ghost your portrait into its new strip position before you commit.

### 3. Extra-turn economies make good group mechanics
- **SMT Press Turn:** each side gets turn icons. Hitting a weakness or landing a critical costs only half an icon, while a miss or a nulled attack costs two, and reflect or absorb can end the whole turn. Enemies follow the same rules. Party composition matters because it decides which weaknesses you can hit.\[6\]\[7\]\[8\]
- **Persona 5 One More / Baton Pass:** downing an enemy grants One More. In Persona 5 you can pass it to an ally, who gets boosted attack and recovery. Each further pass raises the boost, and an ally can only receive the baton once per chain, "preventing an endless loop." When every enemy is down, an All-out Attack follows.\[9\]\[10\] This is the clearest example of a setup-and-payoff handoff *between characters*.
- **Octopath Break and Boost:** each enemy shows a shield count and its weaknesses. Hitting weaknesses removes shields, and at zero the enemy is Broken (stunned, takes more damage). Characters gain 1 Boost Point per turn, store up to 5, and spend up to 3 to multi-hit or power up a skill. The developers told Famitsu they added Break because Boost alone risked turning the game into "a show of dealing big damage." Showing the shield points lets players choose to Boost into a Broken enemy. The Octopath Traveler II producer later admitted Break/Boost "sometimes [become] routine," which is why they added Latent Powers.\[11\]\[12\]\[13\]
- **Bravely Default Brave/Default:** Default guards and banks a Brave Point. Brave spends up to 4 points for extra actions and can go into debt (negative BP), so the character can't act until it recovers. Enemies use the same system, and bosses are built around it. It is a clear risk/reward loop.\[14\]\[15\]\[16\]\[17\]

### 4. Telegraphs turn combat into readable puzzles
- **Slay the Spire's Intent system** shows each enemy's next move (attack with a damage number, buff, debuff, defend, unknown) above its head. In Mega Crit's GDC 2019 talk, Anthony Giovannetti covered how enemy design moved toward predictable patterns and was built alongside card design. Intents change only for stated reasons (stun, HP thresholds, damage-triggered form changes), which keeps them trustworthy.\[18\]\[19\]\[20\]
- **Into the Breach** (Subset Games): "All enemy attacks are telegraphed… Analyze your opponent's attack and come up with the perfect counter every turn." Justin Ma said they "prefer games with clear rulesets… This lead us to use of telegraphed enemy attacks as a core mechanic," and "when every enemy attack is telegraphed and there's no random chance… the game starts to feel like a puzzle."\[21\]\[22\]
- **FFXIV:** lead battle content designer Masaki Nakagawa told GameSpot the team has cut down "sports meet phases" (boss untargetable while players resolve mechanics) because "more players enjoyed resolving mechanics while attacking the boss." He also warned that removing every frustrating mechanic would make "all bosses… end up following the same patterns."\[23\]\[24\]\[25\]
- **WoW:** game director Ion Hazzikostas sorts boss challenges into Dexterity ("we're going to ask you to dance"), Strength (a DPS or healing check), and Intellect (reacting to a variable situation, e.g. "There's a bomb on you and four other players: where do you take it?"). He also said "we're not looking to turn all our raid encounters into giant puzzles." Earlier, he described encounter designers as choreographers dictating "gameplay that we think will be good."\[26\]\[27\]

### 5. Role identity versus interchangeability
- **WoW "bring the player, not the class"** (Wrath of the Lich King, voiced by lead developer Greg Street) responded to extreme class stacking. Key raid buffs were spread across several classes so that skill, not class, earned a raid spot. The cost was weaker class distinctness. Later expansions moved toward each class getting "a moment to shine," and Hazzikostas has said the team wants "every class to have a reason not to be sat."\[28\]\[29\] **Lesson:** guarantee every role a *unique verb*, but don't make any one role *mandatory* for the room to win.
- **FFXIV:** Naoki Yoshida admitted that "maintaining the uniqueness of their job mechanics while balancing their numbers as closely as possible has become extremely taxing." On the official forums, players complain that "job identity is gone it was replaced by role identity."\[30\]\[31\] The healer debate is a warning: one player wrote that "fun of the healer role is negatively aligned with the skill of the party," because in a good group healers end up pressing a one-button DPS filler. Hazzikostas framed healer damage as a way "to contribute effectively when there is downtime in HPS" and wanted choices "instead of just passive damage while healing."\[28\]\[32\]\[33\]
- **Darkest Dungeon:** In Game Developer's "Game Design Deep Dive: Darkest Dungeon's Affliction System," Chris Bourassa and Tyler Sigman explain that every hero carries a Stress meter, and "we needed to completely expose the Stress meter and display stress increases and decreases directly as numbers -- for example, +20 Stress!" Afflictions spread stress to allies, so one player's state becomes the party's problem.

### 6. Game feel ("juice")
- Martin Jonasson and Petri Purho's "Juice it or lose it" (GDC Europe 2012) defines a juicy game as one that "feels alive and responds to everything you do… tons of cascading action and response for minimal user input."\[34\]\[35\]
- Jan Willem Nijman's "The Art of Screenshake" (Vlambeer, INDIGO 2013) takes a boring platform shooter and, "with 30 tweaks to the animation and sound, make[s] it really juicy" (write-up on maryrosecook.com). The tweaks include impact effects, hit animation, enemy knockback, permanence, camera kick, screen shake, and "sleep (momentary pause when hitting enemy)", i.e. hit-stop. Folmer Kelly's counterpoint warns that juice can overwhelm context. Valdemir D.'s "Game feel on the web" (valdemird.com) notes that "shaking the whole viewport on the web is a motion-sickness trigger for some people… It's the difference between juice and an accessibility complaint," so screen shake should be optional.

### 7. Large groups, idle players and latecomers
- **FFXIV alliance raids** run as "24 players (three parties of eight)." Duty Finder parties are "1 tank, 2 healers, and 5 DPS." Area heals such as Medica affect only your own party of 8, and players see much less of other parties' status. The FFXIV Online Wiki's "Raids" page says "the parties are also occasionally forced to split up and take separate routes or otherwise handle groups of enemies separately." Yoshida acknowledged feedback "that alliance raids are getting too simple." Patch 7.15's chaotic alliance raid notes that its "difficulty… has been set for a 24-player alliance and will not scale depending on party size."
- **WoW Flexible raids** scale from 10 to 30 players.\[36\] Boss health and damage grow more slowly than raid throughput, so larger groups are slightly favoured. Blizzard moved abilities that "target more players as the size of a Flex raid increases" to "weighted randomization rather than strict breakpoints."\[37\]\[38\] Hazzikostas has warned that with fully flexible sizing, "players would absolutely manipulate raid size."\[39\]
- **Idle players:** FFXIV's vote-dismiss exists so that "players who are absent for extended periods… can be democratically expelled." WoW's Vote Kick can't be started in or right after combat. In the developer's note on Vote to Kick in Blizzard's Diablo Immortal Season Three update, the team wrote that "as soon as one player holds up the group, others start leaving, and then you're left starting over from scratch." A kick requires a unanimous vote.
- **Jackbox Audience:** Quiplash takes 3–8 core players plus an "Audience" of up to 10,000 who "actually affect the outcome of the game by voting," described as an "enhanced spectator" role. Latecomers join by entering the room code at jackbox.tv "after all players have entered the game or the game has started." In Jackbox's words: "Nobody has to sit out."\[40\]\[41\]\[42\]

## Details: What Translates to a Server-Authoritative CTB Room Raid (synthesis)

| Source mechanic | Translate? | CTB adaptation |
|---|---|---|
| FFX Rank + Haste/Delay | Core | Already your formula; add hover-preview ghosting on the strip |
| SMT Press Turn / P5 One More | Yes, as a rank refund | Hitting an exposed weakness halves that action's rank, so you re-enter the strip sooner (a visible "One More" jump) |
| P5 Baton Pass | Yes, best co-presence mechanic | "Relay": act early and pass a potency bonus to the next *player* portrait on the strip; consecutive player turns form a glowing Chain |
| Octopath Break shields | Yes | Each Orrery ring shows shield pips plus weakness icons; at 0 the ring is Broken and the boss card is pushed back |
| Bravely Brave/Default | Partly | Brace banks 1 Charge (max 3); Charge powers a role's signature move. No negative debt, because debt hides people from the strip in a 40-player room |
| StS / Into the Breach intents | Core | Boss cards on the strip carry an intent icon, a target marker and a number |
| Darkest Dungeon stress | Lightly | A visible "Strain" meter on the boss-tethered players |
| DOS2 armour layers / surfaces | Partly | Ring shields act as armour layers before HP. Surfaces don't fit a non-spatial screen; use "fields" on party *rows* instead |
| BG3 bonus actions/reactions | Partly | One free "Reaction" per player per boss cycle (e.g. Intercept), so idle players have something to watch for |

Note: Divinity: Original Sin 2, BG3 and Diablo design rationale were not verified against primary developer sources in this research. The adaptations above rest on widely documented mechanics and should be treated as the report's own interpretation.

## Recommendations: Prioritised Design Proposal (original designs, the report's own synthesis)

### Priority 1: Action economy (build first)
- **Ranks:** 1 (Quick), 2 (Light), 3 (Standard), 4 (Heavy), 5 (Ultimate). Wait = tickSpeed × rank × haste.
- **Rank refund ("Resonance"):** hitting a ring weakness or a Broken ring cuts the rank by 1 (min 1). The strip animates your portrait jumping forward.
- **Chain:** when 2+ player turns resolve with no boss card between them, a Chain link lights up on the strip. Each link gives +10% potency (cap +50%), and a boss action resets it. This turns "who acts next" into a team conversation.
- **Exposed stacks:** set-up actions put stacks on a ring, and finishers consume them. Every stack shows who applied it, using a coloured pip in that player's role colour.
- **Charge:** Brace (Rank 2) halves incoming damage and banks 1 Charge (max 3). Charge powers each role's signature move.
- **Reaction:** one per player per boss turn, triggered off a telegraphed boss card.
- **Turn timer:** 12 s per decision. On timeout the server auto-Braces (safe, banks Charge) and marks the portrait "drifting" (dimmed). After 3 consecutive timeouts the character becomes an automated, low-output "Echo" until the player taps back in.

### Priority 2: Archetypes (5 core + 1 optional)
| Archetype | Identity / resource | Actions (rank) | Interdependence |
|---|---|---|---|
| **Warden** (tank) | **Resolve**: gained when absorbing hits meant for others | *Intercept* (Reaction): take the next single-target boss hit aimed at a marked ally. *Anchor* (2): force the next targeted boss card onto yourself (visibly retargets on the strip). *Bastion* (4, spends Resolve): −40% to the next raid-wide card. *Counterweight* (3): damage plus Exposed scaled by Resolve | Bastion is how the room survives Perihelion. Anchor swaps Gravity stacks with another Warden |
| **Mender** (active healer) | **Grace**: gained by *pre-emptive* Wards on players a boss card is targeting | *Mend* (2): heal. *Ward* (3): shield a player marked by a boss card, and gain Grace if it absorbs damage. *Quicken* (3): cut an ally's counter by 30% so their portrait moves up. *Restore* (5, 3 Grace): revive, re-entering at Rank 3 delay | Rewards reading the strip instead of reacting to HP. Quicken lets the healer start Chains |
| **Striker** (burst DPS) | **Momentum** (0–5) | *Jab* (1): +1 Momentum. *Cleave* (3): +2 on a weakness. *Finisher* (4): spends all, ×2 vs Broken rings. *Feint* (2): consume 1 Exposed for a guaranteed Resonance | Finisher's best moment comes from the Breaker's Break. Feint cashes in others' Exposed stacks |
| **Breaker** (analyst / debuffer) | **Insight**: revealing weaknesses | *Scan* (2): reveal one ring's hidden weakness to the room. *Pry* (3): remove 2 shield pips if the element matches. *Mark* (2): apply 2 Exposed. *Shatter* (4, 3 Insight): Break a ring at ≤2 pips | Sets up for the Striker. Breaking a ring delays boss cards, buying time for the Mender |
| **Chronist** (time support) | **Flux**: gained whenever any portrait moves on the strip | *Delay* (3): push the next boss card back 1 slot. *Haste* (3): ally gets haste ×0.5 for 2 turns. *Relay* (1): end your turn and hand +25% potency to the next player portrait. *Stillpoint* (5, full Flux): freeze one boss card for a full cycle | The CTB fantasy in its purest form. Keeps Chains alive and rescues failed telegraphs |
| *Optional:* **Cartographer** (squad leader) | **Bearing** | *Plot* (2): pin a target ring for the whole squad (+Exposed on hit). *Rally* (3): squad-wide Charge +1. *Reroute* (3): swap two allies' strip positions | Coordinates the squad. Fits 30–40 player rooms |

Every archetype has at least one action that visibly changes the strip and one action whose value depends on another role. That second point is the single most important rule for "4 different roles beat 4 of the same."

### Priority 3: The Orrery (phases and mechanics)
**Phase I, Outer Ring (100–70%).** Teaches Break and intents. **Phase II, Conjunction (70–35%).** Adds tethers and turn manipulation. **Phase III, Grand Alignment (<35%).** Every 4th boss card is a growing "Alignment" countdown that ends in a wipe at 0 (a visible enrage).

1. **Perihelion (rework: DPS/Break check).** A boss card appears 4 slots ahead with a countdown and a raid-wide damage number. The outer ring gets 3 + (number of squads) shield pips, so it scales with squads, not headcount. Breaking it pushes the card back and halves the damage. Wardens' Bastion covers the rest. *Visual:* the ring glows hotter as the card gets closer.
2. **Conjunction (coordination/diversity).** Two ring pointers lock onto two players from different squads and draw a beam between them. Damage is split among everyone who "Joins" (Rank 2), divided by the number of *distinct roles* that joined. Diversity is rewarded directly, and stacking one role is punished.
3. **Gravity Well (tank swap).** Lunge now adds Gravity to its target. At 3 stacks the next Lunge is lethal unless a second Warden Anchors it. A clear tank-swap moment.
4. **Retrograde (turn-order mechanic).** The boss card shows a reversed arrow. When it resolves, the next 5 portrait slots visibly flip. A Chronist's Delay or Stillpoint cancels it. Turns your core legibility feature into a stake.
5. **Eclipse (healer check).** One squad gets a shadow DoT that stacks each boss turn. Mender Wards cancel one stack per target, and Quicken lets cleanses happen sooner. *Visual:* a dark wedge sweeps over that squad's row.

**Scaling rule:** HP scales with headcount at reduced weight (as WoW's flex does), but mechanic *count* scales with number of squads, and pip counts scale with role mix. Use weighted randomisation, not hard breakpoints, so the room can't game the join count.

### Priority 4: Large-room structure
- Auto-form squads of 4–6 with role quotas (Warden, Mender, plus 2–4 others), each with its own colour band on the strip.
- The strip shows the next ~10 actors plus all boss cards. Your own next slot is always pinned with a "YOU in N" badge. Squad-mates' portraits get a coloured outline.
- **Late joiners:** join at any time by room code, entering at the back of the strip with Rank 3 delay. While waiting they're "Stargazers" who vote (Jackbox-style) on which ring to Scan next, so nobody sits out.

### Priority 5: UI legibility checklist ("show, don't log")
- [ ] Boss cards on the strip show an intent icon, a target marker and a number. The same icon appears on the target's portrait.
- [ ] Command hover ghosts your portrait's new strip position (the FFX preview).
- [ ] Every action follows anticipation (0.2–0.3 s wind-up) → impact (hit-stop of a few frames, flash) → follow-through (number pop, then the bar drains with a delayed "ghost" segment).
- [ ] Damage numbers: size scales with the share of max HP; white = normal, gold = weakness/Resonance, red = damage to players, green = heal, cyan = shield. Crits get a larger outline plus a slight overshoot.
- [ ] The actor's portrait pulses on the strip *and* their sprite steps forward on the field, with a 1-line caption bubble, *before* the log line is written.
- [ ] Shield pips and weaknesses sit on each ring, not in a menu.
- [ ] Status icons: max 4 visible per character, then "+N", with a duration ring around each icon.
- [ ] Screen shake only for boss raid-wide hits, and it can be turned off (motion-sickness setting).
- [ ] Colour is never the only signal; every colour pairs with a shape or icon.

## Caveats
- Several sources are secondary: WoW's "bring the player" comes via Blizzard Watch; FFXIV healer criticism comes from player forums, not developers; Octopath's design rationale comes via Famitsu translations. Persona, SMT and FFX mechanics come from fan wikis (reliable on mechanics, not on intent).
- No primary developer sources were gathered for Diablo III/IV class design, BG3's action economy, or DOS2's armour system. Those parts of the proposal are interpretation.
- Numbers in the proposal (timers, percentages, pip counts) are starting values to playtest, not findings. Run a 12-person and a 30-person playtest before locking them.
- Bravely's "debt" mechanic and Darkest Dungeon's full stress system were deliberately left out, because hidden or locked players hurt co-presence in a room-scale game.

## Sources

1. [GDC 2012: Sid Meier on how to see games as sets of interesting decisions](https://www.gamedeveloper.com/design/gdc-2012-sid-meier-on-how-to-see-games-as-sets-of-interesting-decisions)
2. [GDC 2012: Sid Meier Sees "Interesting Decisions" Even in Rhythm Games - The Escapist](https://www.escapistmagazine.com/gdc-2012-sid-meier-sees-interesting-decisions-even-in-rhythm-games/)
3. [Rank (Final Fantasy X)](<https://finalfantasy.fandom.com/wiki/Rank_(Final_Fantasy_X)>)
4. [Conditional Turn-Based Battle - Final Fantasy Wiki, the Final Fantasy encyclopedia](https://finalfantasywiki.com/wiki/Conditional_Turn-Based_Battle)
5. [Conditional Turn-Based Battle (Concept) - Giant Bomb Video Game Wiki](https://www.giantbomb.com/conditional-turn-based-battle/3015-2432/)
6. [How Does the Shin Megami Tensei Series' Press Turn System Work?](https://www.cbr.com/shin-megami-tensei-press-turn-system/)
7. [Shin Megami Tensei V Beginner's Guide - Hey Poor Player](https://www.heypoorplayer.com/2021/11/13/shin-megami-tensei-v-beginners-guide/)
8. [Battle systems: Shin Megami Tensei](https://www.rpg-o-mania.com/coverage_battlesystems_megamansensei.php)
9. [One More](https://megamitensei.fandom.com/wiki/One_More)
10. [Baton Pass](https://megamitensei.fandom.com/wiki/Baton_Pass)
11. [Octopath Traveler](https://en.wikipedia.org/wiki/Octopath_Traveler)
12. [Project Octopath Traveler devs on the game's origins, demo feedback and improvements, much more](https://nintendoeverything.com/project-octopath-traveler-devs-on-the-games-origins-demo-feedback-and-improvements-more/)
13. [Octopath Traveler 2 Interview: Making Good On Aesthetic & Expectation](https://screenrant.com/octopath-traveler-2-interview-graphics-success/)
14. [Retro Review: Remembering Bravely Default](https://bossrush.net/2021/04/retro-review-remembering-bravely-default/)
15. [Brave Point - Bravely Wiki - Neoseeker](https://bravely.neoseeker.com/wiki/Brave_Points)
16. [Bravely Default (3DS, 2014) - Graded VGA 95 Mint Uncirculated](https://www.ebay.de/itm/405304966918)
17. [Review: Bravely Default](https://hardcoregamer.com/reviews/review-bravely-default/71370/)
18. [Enemies changing intent :: Slay the Spire General Discussions](https://steamcommunity.com/app/646570/discussions/0/5015307809836759698/)
19. [Intent](https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Intent)
20. [Slay the Spire: Metrics Driven Design and Balance](https://podwise.ai/episodes/1459444)
21. [Subset Games](https://subsetgames.com/presskit/sheet.php?p=into_the_breach)
22. [Road to the IGF: Subset Games' Into the Breach](https://www.gamedeveloper.com/game-platforms/road-to-the-igf-subset-games-i-into-the-breach-i-)
23. [How Final Fantasy XIV's Toughest Battles Are Designed: A Deep Dive On Savage Raids - GameSpot](https://www.gamespot.com/articles/how-final-fantasy-xivs-toughest-battles-are-designed-a-deep-dive-on-savage-raids/1100-6517559/)
24. [Feedback vs. Expectations: Exploring Final Fantasy XIV's Battle Design Evolution](https://www.mmorpg.com/features/feedback-vs-expectations-exploring-final-fantasy-xivs-battle-design-evolution-2000133840)
25. [FF14 director Yoshida has big plans to build on Dawntrail's combat](https://www.pcgamesn.com/final-fantasy-xiv/ff14-dawntrail-combat-yoshida-interview)
26. [World of Warcraft director admits it's too hard without combat mods and explains how bosses will change in Midnight: 'We're not looking to turn all our raid encounters into giant puzzles for people to solve'](https://www.pcgamer.com/games/world-of-warcraft/world-of-warcraft-director-admits-its-too-hard-without-combat-mods-and-explains-how-bosses-will-change-in-midnight-were-not-looking-to-turn-all-our-raid-encounters-into-giant-puzzles-for-people-to-solve/)
27. [World of Warcraft 5.2 raids: the art and science of raid design](https://www.pcgamesn.com/wow/world-warcraft-52-raids-art-and-science-raid-design)
28. [Preach Developer Interview with Ion Hazzikostas - Patch 9.1 - MMO-Champion](https://www.mmo-champion.com/content/9851-Preach-Developer-Interview-with-Ion-Hazzikostas-Patch-9-1)
29. [Wrath of the Lich King Classic will run on patch 3.3.5 — but what does that mean?](https://blizzardwatch.com/2022/04/25/wrath-lich-king-classic-will-run-patch-3-3-5-mean/)
30. [Yoshi's Comment on Future Job Design - Are Jobs](https://forum.square-enix.com/ffxiv/threads/465123-Yoshi-s-Comment-on-Future-Job-Design-Are-Jobs)
31. [Final Fantasy XIV's 10th Anniversary, Job Design, Expansions, & Successes: An Interview With Naoki Yoshida](https://screenrant.com/final-fantasy-xiv-10th-anniversary-interview-naoki-yoshida/)
32. [Mr Happy Interview with Yoshida: Glare Mages - Page 18](https://forum.square-enix.com/ffxiv/threads/444651/?page=18)
33. [\[Petition\] Have Naoki Yoshida Play Healer and take off the DPS Gloves for a year.](https://forum.square-enix.com/ffxiv/threads/460657-Petition-Have-Naoki-Yoshida-Play-Healer-and-take-off-the-DPS-Gloves-for-a-year.)
34. [Video: Indies, resist the urge to 'juice it or lose it'](https://www.gamedeveloper.com/design/video-indies-resist-the-urge-to-juice-it-or-lose-it-)
35. [Juice it or lose it - a talk by Martin Jonasson & Petri Purho Podcast - Listenbox](https://listenbox.app/i/qBXiANa3p9gX)
36. [World of Warcraft: Warlords of Draenor](https://en.wikipedia.org/wiki/World_of_Warcraft:_Warlords_of_Draenor)
37. [Flexible Raid - Wowpedia - Your wiki guide to the World of Warcraft](https://wowpedia.fandom.com/wiki/Flexible_Raid)
38. [Flexible Raid - Warcraft Wiki - Your wiki guide to the World of Warcraft](https://warcraft.wiki.gg/wiki/Flexible_Raid)
39. [PsybearTV Interview with Ion Hazzikostas - The Mythic Raid Lockout, Addons, 8-Week Content Schedule — Seramate](https://seramate.com/news/2026/07/01/ion-hazzikostas-psybeartv-interview-1f1758c4)
40. [The Jackbox Party Pack 5 Streamer's Guide | Jackbox Games](https://www.jackboxgames.com/blog/the-jackbox-party-pack-5-streamers-guide)
41. [Quiplash](https://www.jackboxgames.com/games/quiplash)
42. [Quiplash: New Party Game Expands “Audience” Participation to 10,000](https://blog.playstation.com/2015/06/30/quiplash-new-party-game-expands-audience-participation-to-10000/)
