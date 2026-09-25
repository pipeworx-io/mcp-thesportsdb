# @pipeworx/thesportsdb

TheSportsDB MCP — sports catalog across 50+ leagues: teams, players, events, venues, league tables. Free tier with public key.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1679+ live data sources.

## Tools

- `list_sports()` / `list_leagues(sport?, country?)`
- `search_teams(query)`, `get_team(team_id)`, `league_teams(league_id)`
- `search_players(query)` / `get_player(player_id)`
- `team_events_last(team_id)` / `team_events_next(team_id)`
- `events_by_day(date, sport?, league?)`
- `league_table(league_id, season?)`

## Auth

The free public tier uses API key `3` (well-known, no signup required). Pipeworx defaults to this. For higher rate limits / extra endpoints register at https://www.thesportsdb.com/ and BYO via `?_apiKey=<key>`.

## Data source

`https://www.thesportsdb.com/api/v1/json/<apiKey>/`

## Match detail (event_detail, event_timeline, event_stats, event_lineup)

Four per-match tools for settling questions about a single fixture: the
scoreline and venue (`event_detail`), goals with scorer/assist/minute plus cards
and substitutions (`event_timeline`), team-by-team statistics (`event_stats`),
and the starting eleven plus substitutes (`event_lineup`). All take a
TheSportsDB `event_id` — find one with `events_by_day`, `team_events_last` or
`team_events_next`.

### They are NOT premium-gated — but the free tier truncates them

Measured 2026-09-12 on the free public key: all four endpoints return real data,
so no key is required and none of these tools refuses for want of one.

What the free tier *does* do is cap each array at **5 rows, silently**. On
idEvent 2594568 (Bayern Munich vs Bodø/Glimt, final score **5-0**) the timeline
returns 5 rows, the earliest at minute 45, containing **2 goals** — every
first-half goal is absent. `event_stats` returns 5 statistics and does not
include shots on goal, corners or possession. `event_lineup` returns 5 players.
`intHomeScoreHT` / `intAwayScoreHT` come back null.

So for a settlement workload a supporter key matters — for **completeness**, not
for access. Pass it as `_apiKey`.

### How the tools tell you

`event_timeline` cross-checks the goals it can see against the event's own final
score. When they disagree it returns `complete: false` with
`goals_in_timeline`, `goals_in_final_score` and a note saying not to settle a
first-scorer or half-time question from it. That is proof of truncation, not a
guess. `event_stats` and `event_lineup` have no equivalent invariant, so they
report `complete: null` when exactly 5 rows come back — which may be a whole
small result or a truncated large one, and from the response alone those are
indistinguishable.

### Coverage is per-competition

A match the source has not covered returns `found: false` with a reason, never
an error and never a wrong answer. The tools distinguish two cases that arrive
identically from upstream (both are a bare `null`): `no_timeline_for_event` —
the match exists and is named back to you, the source just has no timeline for
that competition — versus `no_data_and_event_unconfirmed`, where the event id
could not be confirmed either. For a caller settling a market those are opposite
conclusions: "ask a different source" versus "you have the wrong match".

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "thesportsdb": {
      "url": "https://gateway.pipeworx.io/thesportsdb/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/thesportsdb/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1679+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

This pack takes your own API key (`_apiKey`) — we don't front one for it, so there's no curl here that would run without it. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/thesportsdb_list_sports`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

```json
{
  "mcpServers": {
    "thesportsdb": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-thesportsdb"]
    }
  }
}
```

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-thesportsdb
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Thesportsdb data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
