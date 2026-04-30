# Run-In Position Calculator (MVP)

A lightweight browser app to calculate each team's:

- current position
- highest possible final position
- lowest possible final position

## Usage

1. Open `index.html` in a browser.
2. Enter standings CSV in this format:

   `team,points,goalDifference,goalsFor`

3. Enter remaining fixtures CSV in this format:

   `homeTeam,awayTeam`

4. Click **Calculate**.

## Model used

This MVP uses a fast points-range approach:

- `maxPoints = currentPoints + (matchesLeft * 3)`
- `minPoints = currentPoints`
- `highestPossible = 1 + number of teams guaranteed above maxPoints`
- `lowestPossible = leagueSize - number of teams guaranteed below minPoints`

It is useful for quick "mathematical possibility" ranges and does not fully model every fixture dependency.

## Exact fixture-aware mode

The app now also includes an exact mode that enumerates all possible outcomes for the provided fixture list:

- home win
- draw
- away win

This mode is fully fixture-dependent but computationally expensive (`3^n` scenarios), so it is capped at 14 fixtures per run.

## Monte Carlo fixture-aware mode

For larger fixture sets, the app includes a Monte Carlo mode that:

- samples random fixture outcomes across all remaining matches
- respects fixture dependencies (shared matches affect both teams)
- estimates best/worst observed finishes across simulation runs

You can configure simulation count (100 to 200000). Higher counts are slower but usually produce more stable estimates.
