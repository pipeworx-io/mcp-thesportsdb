interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * TheSportsDB MCP — sports catalog (teams, players, events)
 *
 * Free public tier uses key "3" (no signup). Higher tiers via Patreon
 * supporters; we accept BYO key for those.
 *
 * Docs: https://www.thesportsdb.com/free_sports_api
 */


const DEFAULT_KEY = '3';

const tools: McpToolExport['tools'] = [
  {
    name: 'list_sports',
    description: 'List all sports tracked by TheSportsDB.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_leagues',
    description: 'List leagues, optionally filtered by sport name and/or country.',
    inputSchema: {
      type: 'object',
      properties: {
        sport: { type: 'string', description: 'Sport name (e.g. "Soccer", "Ice Hockey")' },
        country: { type: 'string', description: 'Country name' },
      },
    },
  },
  {
    name: 'search_teams',
    description: 'Search teams by name (full or partial).',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'get_team',
    description: 'Team profile by ID.',
    inputSchema: {
      type: 'object',
      properties: { team_id: { type: 'string', description: 'TheSportsDB team id' } },
      required: ['team_id'],
    },
  },
  {
    name: 'league_teams',
    description: 'All teams in a league.',
    inputSchema: {
      type: 'object',
      properties: { league_id: { type: 'string' } },
      required: ['league_id'],
    },
  },
  {
    name: 'search_players',
    description: 'Search players by name.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'get_player',
    description: 'Player profile by ID.',
    inputSchema: {
      type: 'object',
      properties: { player_id: { type: 'string' } },
      required: ['player_id'],
    },
  },
  {
    name: 'team_events_last',
    description: 'Last 5 events for a team.',
    inputSchema: {
      type: 'object',
      properties: { team_id: { type: 'string' } },
      required: ['team_id'],
    },
  },
  {
    name: 'team_events_next',
    description: 'Next 5 events for a team.',
    inputSchema: {
      type: 'object',
      properties: { team_id: { type: 'string' } },
      required: ['team_id'],
    },
  },
  {
    name: 'events_by_day',
    description: 'All events on a given date, optionally filtered by sport or league.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        sport: { type: 'string', description: 'Sport name filter' },
        league: { type: 'string', description: 'League name filter' },
      },
      required: ['date'],
    },
  },
  {
    name: 'league_table',
    description: 'Standings table for a league/season.',
    inputSchema: {
      type: 'object',
      properties: {
        league_id: { type: 'string' },
        season: { type: 'string', description: 'Season string, e.g. "2024-2025" (default current)' },
      },
      required: ['league_id'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = (args._apiKey as string | undefined)?.trim() || DEFAULT_KEY;
  const base = `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(apiKey)}`;
  switch (name) {
    case 'list_sports':
      return sdbGet(`${base}/all_sports.php`);
    case 'list_leagues': {
      if (args.sport || args.country) {
        const params = new URLSearchParams();
        if (args.sport) params.set('s', String(args.sport));
        if (args.country) params.set('c', String(args.country));
        return sdbGet(`${base}/search_all_leagues.php?${params}`);
      }
      return sdbGet(`${base}/all_leagues.php`);
    }
    case 'search_teams': {
      const params = new URLSearchParams({ t: reqStr(args, 'query', '"Arsenal"') });
      return sdbGet(`${base}/searchteams.php?${params}`);
    }
    case 'get_team': {
      const params = new URLSearchParams({ id: reqStr(args, 'team_id', '"133604"') });
      return sdbGet(`${base}/lookupteam.php?${params}`);
    }
    case 'league_teams': {
      const params = new URLSearchParams({ id: reqStr(args, 'league_id', '"4328"') });
      return sdbGet(`${base}/lookup_all_teams.php?${params}`);
    }
    case 'search_players': {
      const params = new URLSearchParams({ p: reqStr(args, 'query', '"Messi"') });
      return sdbGet(`${base}/searchplayers.php?${params}`);
    }
    case 'get_player': {
      const params = new URLSearchParams({ id: reqStr(args, 'player_id', '"34145937"') });
      return sdbGet(`${base}/lookupplayer.php?${params}`);
    }
    case 'team_events_last': {
      const params = new URLSearchParams({ id: reqStr(args, 'team_id', '"133604"') });
      return sdbGet(`${base}/eventslast.php?${params}`);
    }
    case 'team_events_next': {
      const params = new URLSearchParams({ id: reqStr(args, 'team_id', '"133604"') });
      return sdbGet(`${base}/eventsnext.php?${params}`);
    }
    case 'events_by_day': {
      const params = new URLSearchParams({ d: reqStr(args, 'date', '"2024-09-15"') });
      if (args.sport) params.set('s', String(args.sport));
      if (args.league) params.set('l', String(args.league));
      return sdbGet(`${base}/eventsday.php?${params}`);
    }
    case 'league_table': {
      const params = new URLSearchParams({
        l: reqStr(args, 'league_id', '"4328"'),
      });
      if (args.season) params.set('s', String(args.season));
      return sdbGet(`${base}/lookuptable.php?${params}`);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function sdbGet(url: string) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'pipeworx-mcp-thesportsdb/1.0 (+https://pipeworx.io)',
    },
  });
  if (res.status === 429) throw new Error('TheSportsDB: rate-limit (HTTP 429)');
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`TheSportsDB error: ${res.status} ${t.slice(0, 200)}`);
  }
  return res.json();
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  }
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
