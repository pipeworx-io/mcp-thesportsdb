# mcp-thesportsdb

TheSportsDB MCP — sports catalog (teams, players, events)

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 250+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `list_sports` | List all sports tracked by TheSportsDB. |
| `list_leagues` | List leagues, optionally filtered by sport name and/or country. |
| `search_teams` | Search teams by name (full or partial). |
| `get_team` | Team profile by ID. |
| `league_teams` | All teams in a league. |
| `search_players` | Search players by name. |
| `get_player` | Player profile by ID. |
| `team_events_last` | Last 5 events for a team. |
| `team_events_next` | Next 5 events for a team. |
| `events_by_day` | All events on a given date, optionally filtered by sport or league. |
| `league_table` | Standings table for a league/season. |

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

Or connect to the full Pipeworx gateway for access to all 250+ data sources:

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

- [All tools and guides](https://github.com/pipeworx-io/examples)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
