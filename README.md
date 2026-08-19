# Slate

A paced media planner. Takes the backlog you already have — films, books, essays,
lectures — and turns it into a weekly slate that survives contact with real life.

Not a tracker (solved). Not a recommender (solved). The middle: converting intent
into a realistic cadence, and reflowing gracefully when you fall behind.

**North star: completion rate.** Not items tracked, not library size.

> **Status: Phase 1 of the handoff plan, built ahead of Phase 0.** The five-person
> manual test has not run yet. If it fails, this code should be discarded rather
> than revised — the whole thing is a bet that the scheduler was the bottleneck.
> What it is good for right now: running Phase 0's real cases through real logic
> instead of a spreadsheet.

## Run it

```sh
npm install
npm test                                # 36 tests, all four craft behaviours
npx tsx src/cli/index.ts seed           # demo data
npx tsx src/cli/index.ts week
npx tsx src/web/server.ts               # the shelf at localhost:4173
```

Use `npx tsx src/cli/index.ts …` rather than `npm run slate …` — npm eats the
`--flags` before they reach the CLI.

State is one JSON file at `data/slate.json` (override with `SLATE_DATA`). The CLI
and the web shelf read and write the same file, so you can drive either.

## The four behaviours the craft budget goes to

Everything else is plumbing. These are in `test/behaviour.test.ts`.

### 1. When you miss

**Push the date, hold the rate.** Recalculating the rate upward to protect the end
date is the Anki death spiral: the number climbs, you fall further behind, you quit.

Sessions are generated forward from where you actually are, never from a fixed
calendar grid, so a session can't be dated in the past. Miss five nights and
tonight's card still says 40 pages; the projected finish quietly slides five days.

Rate recalculation exists, but only on a commitment explicitly flagged
`hardDeadline` (book club, exam). Never the default.

### 2. When you're ahead

**Credit rolls forward.** Read 90 pages on Sunday at 40 a night and two sessions
are banked — Monday is free, Tuesday resumes at p. 130.

Note what this deliberately does *not* do: a small surplus buys a rest day, not an
earlier finish. The finish only pulls in once the surplus is worth a whole session.
Getting ahead should feel like slack, not like a new baseline.

### 3. A bad day

Defer and skip are free, one-tap, and change no numbers. Nothing is ever "late" —
no overdue badge, no red count, no cascade. Deferring asks *why*, because
"too heavy tonight" vs. "forgot" vs. "couldn't find it" point at three different
products, and that log is the only thing here that compounds.

### 4. Dying quietly

Untouched for ~3 weeks and a commitment drops back to the shelf with its progress
intact. Not a failure state, not a notification. Resuming costs nothing.

## Data model

**Commitments, not calendar events.**

- **Point** — a film, an essay, a lecture → one todo.
- **Series** — a book, a season, a course → a generated todo series.

### Any two of three

Each series takes any two of `total`, `rate`, `endDate` and derives the third:

```sh
npx tsx src/cli/index.ts pace "The Magic Mountain" --total 706 --rate 40   # habit
npx tsx src/cli/index.ts pace "The Magic Mountain" --total 706 --by 2026-08-30  # deadline
```

Same object, two entry points. These are genuinely different intentions and the UI
doesn't collapse them.

### Other settled behaviour

| Behaviour | How it works here |
|---|---|
| Internal unit | Fraction complete (`progress / total`). Display unit is whatever the format makes natural — pages, episodes, minutes. |
| Chunking | Sessions snap to chapters, not pages: "read to the end of ch. 8" beats "read to p. 212" even at 46 pages instead of 40. **With a tolerance** — see below. |
| Progress capture | Binary check-off by default. `at "<title>" 212` re-derives the series from where you actually are. Nightly page-number entry is friction that kills the product. |
| Expiry | ~3 weeks untouched → back to the shelf, progress kept. |

**On the snapping tolerance.** Blind nearest-boundary snapping breaks when chapters
are longer than the nightly rate: 65-page chapters against a 40-page rate quietly
turn every session into 65 pages, a 60% inflation the user never agreed to. So a
session stretches or shrinks by at most ~35% of the rate to reach a boundary;
past that it keeps the raw target and the label says *(into ch. 4)*.

## What's here and what isn't

**Here:** the model, series derivation, reflow, credit rollforward, quiet expiry,
deferral signal, Letterboxd / Goodreads / free-text paste import, a CLI, and a
local shelf UI.

**Not here, on purpose:**

- **External task-app sync.** Phase 3. The design holds — materialize only a
  rolling ~7-day window into Apple Reminders / Google Tasks / CalDAV, so reflow
  means *creating a few items* rather than deleting fifty. `planWindow(state, from, days)`
  is already that window; nothing else needs to change to add it.
- **Share links.** Phase 4.
- **Syllabus generation.** If an LLM can produce a decent Nouvelle Vague syllabus
  in a chat window, it's a prompt, not a product.
- **Vibe / mood filtering.** Post-MVP, and it slots in as a filter over the pool,
  not a change to the scheduler. The signal comes free from the deferral log:
  something pushed four Tuesdays running is heavy for this person, whatever its tags.
- **Discovery, browse, ranking, our own calendar UI, "life OS."**

The shelf UI is deliberately not a todo list. Todo apps are obligation machines —
"read 40 pages of *The Magic Mountain*" next to "renew car insurance" converts a
pleasure into a chore. This is where you add things, see the shape of the next few
weeks, and pick something when the plan doesn't fit your mood.

## CLI

```
shelf                            what you have, and what's paced
today / week [--days 7]          the slate, and the shape of it
add "<title>" [--format book|film|tv|essay|lecture|course|album] [--creator X]
import <file> [--as letterboxd|goodreads|paste] [--dry] [--limit N]
pace "<title>" --total 706 --rate 40 [--days daily|weekdays|mon,wed,fri]
               [--chapters 48,110,180] [--at 90]
pace "<title>" --total 706 --by 2026-08-30 [--deadline]
pace "<title>" --kind point [--on 2026-07-30]
done "<title>"                   check off what's due
at "<title>" 212                 resync: where you actually are
defer "<title>" [--days 1] [--reason "too heavy tonight"]
drop | resume | status "<title>"
seed | serve
```

## Layout

```
src/core/time.ts        day-granularity dates, session weekdays
src/core/types.ts       Item, Commitment (point | series), Event, State
src/core/derive.ts      any two of {total, rate, endDate} -> the third
src/core/chunks.ts      chapter snapping, with tolerance
src/core/schedule.ts    session generation, projected finish, rolling window
src/core/actions.ts     progress banking, defer, expiry sweep, deferral signal
src/core/store.ts       JSON file
src/importers/          Letterboxd, Goodreads, free-text paste
src/cli/                the CLI
src/web/                local server + the shelf (no build step, vanilla JS)
```

## Known gaps

- **Availability isn't a scheduler input.** A film planned for Thursday that isn't
  streaming anywhere is a dead slot, and two dead slots teach the user to distrust
  the plan. Unresolved whether this is MVP-critical.
- **Free-text parsing is heuristic.** It handles bullets, "Title — Author",
  "(1994, film, 102 min)", and Goodreads/Letterboxd CSV. It will misfile things.
  Falls back to `other` rather than dropping a line.
- **No auth, no multi-user, no sync.** Local file, single person.
- **Expiry on a rented surface** is the open problem for Phase 3: we can only
  *delete* from an external task app, which looks like data loss.
