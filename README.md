# RNG∞

A random number game with **no daily limit**, inspired by [rngdle.com](https://www.rngdle.com/).
Each roll gives a number between 0 and 1,000,000, scored by the original game's 233 badges (palindromes, primes, sequences, meme numbers…) that award EP,
plus custom badges defined in `tools/source/custom.json` — currently **Drastix** 💥: the number contains "235", 25,000 EP.

**[Play →](https://sacha9214.github.io/rng-infinite/)**

![Roll screen](docs/apercu.png)

## What it adds to the original

- Unlimited rolls (press **Space** to roll again); as in the original, neither the digits nor the badges can be skipped
- Full **history**: search by number or badge, filter by rarity, sort by EP
- **Stats**: rarity distribution vs. expected odds, EP per roll, digit frequency, streaks without a Rare
- **Collection** of all 233 badges with a counter, first roll and odds for each badge
- Previously rolled numbers are flagged, new badges are marked **NEW**
- JSON export/import of the history, 3 badge reveal speeds, light/dark theme

## Faithful to the original game

The engine (`js/engine.js`) is a rewrite, validated by `tools/build.mjs`:

1. all 1,000,001 possible numbers are analyzed, and each badge's score is derived from its actual frequency
   (`100 × 1,000,001 / number of matching numbers`); it must equal the reference score → **233/233**
2. the EP totals of 96 real rolls taken from the original leaderboard must match exactly → **96/96**

The percentile table (card rarity, "TOP x %") is computed from the same enumeration.

A Roblox version of the game, with the same Luau-ported engine, lives in [`roblox/`](roblox/).

## Run locally

Static site, no dependencies:

```bash
python3 -m http.server 8123
```

Regenerate the data after changing the engine:

```bash
node tools/build.mjs
```

Before each commit, version the CSS/JS files to bust the GitHub Pages cache:

```bash
node tools/stamp.mjs
```

## Leaderboard (coming soon)

Since rolls are unlimited, the leaderboard will rank the **best single roll** (day / week / all-time) rather than total EP.
`player.id` and `player.name` are already stored locally for this.

## License

[MIT](LICENSE)
