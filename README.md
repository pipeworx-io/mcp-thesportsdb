# @pipeworx/thesportsdb

TheSportsDB MCP — sports catalog across 50+ leagues: teams, players, events, venues, league tables. Free tier with public key.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Thesportsdb data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
