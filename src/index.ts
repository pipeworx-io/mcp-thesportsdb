interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    throw err;
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/**
 * TheSportsDB MCP — sports catalog (teams, players, events)
 *
 * Free public tier uses key "3" (no signup). Higher tiers via Patreon
 * supporters; we accept BYO key for those.
 *
 * THE FOUR MATCH-DETAIL TOOLS ARE NOT PREMIUM-GATED, despite fleet #1894/#1896
 * both filing them as BYO-premium. Measured 2026-09-12 on the FREE key "3":
 * lookupevent, lookuptimeline, lookupeventstats and lookuplineup all return
 * real data for idEvent 2594568. So they are wired like every other tool here
 * and carry NO "requires an API key" refusal — writing one would tell a caller
 * a key is needed when it is not, which is the same class of false statement
 * the gated-refusal rule exists to prevent, pointed the other way. A BYO
 * _apiKey still works and still raises the rate limit.
 * (The free key IS restricted elsewhere — all_leagues.php returns 5 leagues on
 * it — so "free tier" is not uniformly generous; it just covers these four.)
 *
 * BUT THE FREE KEY TRUNCATES THESE ARRAYS TO 5 ROWS, SILENTLY, AND THAT IS THE
 * DANGEROUS PART. Measured 2026-09-12 on idEvent 2594568, Bayern Munich vs
 * Bodø/Glimt, a match that finished 5-0: lookuptimeline returns exactly 5 rows,
 * the earliest at minute 45, showing TWO goals. Every first-half goal is
 * missing. A caller settling "who scored first" off that answers Musiala 47'
 * and is wrong. lookupeventstats returns 5 stats and does not include shots on
 * goal, corners or possession — the three the reporter asked for by name — and
 * lookupevent's intHomeScoreHT/intAwayScoreHT are null, so the half-time score
 * is not there either. lookuplineup returns 5 players for a 36-man squad list.
 *
 * So a supporter key IS needed for this workload after all — not for ACCESS,
 * which is what fleet #1894/#1896 assumed, but for COMPLETENESS. The tools
 * below therefore never hand back a truncated array as if it were whole: they
 * cross-check the timeline's goal count against the event's own final score and
 * say `complete: false` when the numbers disagree, and flag the exact-5 shape
 * everywhere else. A silent partial is worse than an error for a settlement
 * caller, because it settles.
 *
 * Docs: https://www.thesportsdb.com/free_sports_api
 */


// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'TheSportsDB');
}

const DEFAULT_KEY = '3';

const tools: McpToolExport['tools'] = [
  {
    name: 'list_sports',
    description: 'Return all sports tracked by TheSportsDB (e.g. Soccer, Ice Hockey, Basketball), each with id, name, and forum.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_leagues',
    description: 'List the sports leagues catalogued by TheSportsDB, optionally narrowed by sport name (Soccer, Ice Hockey, Basketball, American Football, Baseball) and by country name. Returns each league id, name, alternate name, sport, and country; the league id feeds league_teams and league_table in this pack. Answers which leagues exist for a sport or a country, and what league id to use next.',
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
    description: 'Search TheSportsDB for sports teams by name — football/soccer clubs in any league worldwide including lower divisions, plus NBA, NFL, MLB and more. Returns team id (use with team_events_next / team_events_last for fixtures and results), sport, league, country, stadium, and description.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'get_team',
    description: 'Full team profile from TheSportsDB by numeric team_id — returns name, sport, country, stadium, formed year, description, badge, and social links.',
    inputSchema: {
      type: 'object',
      properties: { team_id: { type: 'string', description: 'TheSportsDB team id' } },
      required: ['team_id'],
    },
  },
  {
    name: 'league_teams',
    description: 'List all teams in a TheSportsDB league by league_id; returns each team\'s id, name, badge, and country.',
    inputSchema: {
      type: 'object',
      properties: { league_id: { type: 'string' } },
      required: ['league_id'],
    },
  },
  {
    name: 'search_players',
    description: 'Search TheSportsDB for players by name. Returns player id, current team, nationality, position, and description. Use search_teams first to find team IDs if needed.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'get_player',
    description: 'Full player profile from TheSportsDB by numeric player_id — returns name, team, nationality, position, birth date, description, and thumbnail.',
    inputSchema: {
      type: 'object',
      properties: { player_id: { type: 'string' } },
      required: ['player_id'],
    },
  },
  {
    name: 'team_events_last',
    description: 'Recent results for a team: the 5 most recently completed games/matches/fixtures by team_id (from search_teams); returns event name, date, home/away teams, and final score. Works for any league worldwide including lower divisions.',
    inputSchema: {
      type: 'object',
      properties: { team_id: { type: 'string' } },
      required: ['team_id'],
    },
  },
  {
    name: 'team_events_next',
    description: 'Upcoming fixtures for a team: the next 5 scheduled games/matches by team_id (from search_teams); returns event name, kickoff date/time, home/away teams, league, and venue. Works for any league worldwide including lower divisions (e.g. Norwegian 1. Divisjon).',
    inputSchema: {
      type: 'object',
      properties: { team_id: { type: 'string' } },
      required: ['team_id'],
    },
  },
  {
    name: 'events_by_day',
    description: 'Sports schedule/fixtures for a given date — all games/matches on that day, optionally filtered by sport or league. PREFER OVER WEB SEARCH for "what games are on today/tomorrow", "NHL ice hockey schedule", "NBA games tonight", "soccer fixtures". For "next 24h" pass today\'s and tomorrow\'s date. Sport filter examples: "Ice Hockey" (NHL), "Basketball" (NBA), "Soccer", "American Football" (NFL), "Baseball" (MLB).',
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
  {
    name: 'event_detail',
    description:
      'One match by its TheSportsDB event id: final and half-time score, competition, season, round, venue, date and kickoff time, and the goal detail strings where the source carries them. Use for settling a match-level question (who won, what was the half-time score) after finding the event id with events_by_day, team_events_last or team_events_next.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'TheSportsDB idEvent, e.g. "2594568".' },
        _apiKey: { type: 'string', description: 'Optional TheSportsDB key. The free tier serves this tool; a supporter key raises the rate limit.' },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'event_timeline',
    description:
      'Minute-by-minute timeline for one match: goals with scorer and assist, cards, and substitutions, each with the minute and which side it belongs to. Use for settling scorer, first-goal and card questions. COVERAGE IS PER-COMPETITION, not universal — a match the source has not covered returns found:false with a reason, not an error and not a wrong answer.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'TheSportsDB idEvent, e.g. "2594568".' },
        _apiKey: { type: 'string', description: 'Optional TheSportsDB key. The free tier serves this tool; a supporter key raises the rate limit.' },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'event_stats',
    description:
      'Team-by-team match statistics for one event — shots on goal, corners, possession, fouls, passes and whatever else the source recorded, as home/away pairs. Use for settling shot-count, corner and possession questions. COVERAGE IS PER-COMPETITION: a match the source has not covered returns found:false with a reason, not an error.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'TheSportsDB idEvent, e.g. "2594568".' },
        _apiKey: { type: 'string', description: 'Optional TheSportsDB key. The free tier serves this tool; a supporter key raises the rate limit.' },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'event_lineup',
    description:
      'Starting eleven and substitutes for one match, per side, with each player\'s position, squad number and TheSportsDB player id. COVERAGE IS PER-COMPETITION: a match the source has not covered returns found:false with a reason, not an error.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'TheSportsDB idEvent, e.g. "2594568".' },
        _apiKey: { type: 'string', description: 'Optional TheSportsDB key. The free tier serves this tool; a supporter key raises the rate limit.' },
      },
      required: ['event_id'],
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
    case 'event_detail': {
      const id = reqStr(args, 'event_id', '"2594568"');
      const data = (await sdbGet(`${base}/lookupevent.php?${new URLSearchParams({ id })}`)) as { events?: unknown[] | null };
      const ev = (data.events ?? [])[0] as Record<string, unknown> | undefined;
      if (!ev) {
        return { event_id: id, found: false, reason: 'event_not_found', hint: `TheSportsDB has no event with id ${id}. Find one with events_by_day({date}), team_events_last({team_id}) or team_events_next({team_id}).` };
      }
      return { event_id: id, found: true, event: ev };
    }
    case 'event_timeline':
      return eventSubResource(base, args, 'lookuptimeline', 'timeline', 'timeline');
    case 'event_stats':
      return eventSubResource(base, args, 'lookupeventstats', 'eventstats', 'statistics');
    case 'event_lineup':
      return eventSubResource(base, args, 'lookuplineup', 'lineup', 'lineup');
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// The three match-detail sub-resources all answer an uncovered match with the
// SAME shape as a nonexistent one: `{"timeline": null}`, `{"eventstats": null}`,
// `{"lineup": null}` — measured 2026-09-12, idEvent 2481836 (Danish Superliga)
// returns null on all three while 2594568 (Champions League) returns full
// arrays. Handing that straight back makes a coverage gap indistinguishable
// from a bad event id, and for a caller settling a scorer market those are
// opposite conclusions: one means "ask a different source", the other means
// "you have the wrong match". So on a null we ask whether the EVENT exists and
// say which of the two it is. Only the empty case pays the extra request.
// The observed free-tier row cap. Exactly this many rows is not proof of
// truncation — a match really can have five timeline entries — which is why it
// is reported as "possibly", and why the timeline path prefers the score
// cross-check below, that IS proof.
const FREE_TIER_ROW_CAP = 5;
const UPGRADE_NOTE =
  'TheSportsDB\'s free tier caps these arrays at 5 rows. Pass a supporter key as _apiKey for the complete set.';

async function eventSubResource(
  base: string,
  args: Record<string, unknown>,
  endpoint: string,
  field: string,
  label: string,
): Promise<unknown> {
  const id = reqStr(args, 'event_id', '"2594568"');
  const data = (await sdbGet(`${base}/${endpoint}.php?${new URLSearchParams({ id })}`)) as Record<string, unknown>;
  const rows = data?.[field];
  if (Array.isArray(rows) && rows.length > 0) {
    const out: Record<string, unknown> = { event_id: id, found: true, count: rows.length, [field]: rows };
    if (field === 'timeline') {
      // PROOF, not a guess: the event record carries the final score. If the
      // timeline shows fewer goals than the scoreline, rows are missing, and we
      // can say so as a fact rather than a suspicion.
      const ev = await sdbGet(`${base}/lookupevent.php?${new URLSearchParams({ id })}`)
        .then((d) => ((d as { events?: unknown[] | null }).events ?? [])[0] as Record<string, unknown> | undefined)
        .catch(() => undefined);
      const scored = Number(ev?.intHomeScore ?? NaN) + Number(ev?.intAwayScore ?? NaN);
      const goalsSeen = rows.filter((r) => String((r as Record<string, unknown>).strTimeline ?? '').toLowerCase() === 'goal').length;
      if (Number.isFinite(scored) && goalsSeen < scored) {
        out.complete = false;
        out.goals_in_timeline = goalsSeen;
        out.goals_in_final_score = scored;
        out.truncation_note = `INCOMPLETE: the match finished ${String(ev?.intHomeScore)}-${String(ev?.intAwayScore)} (${scored} goals) but only ${goalsSeen} appear in this timeline, so earlier entries are missing. Do NOT settle a first-scorer or half-time question from this. ${UPGRADE_NOTE}`;
      } else if (Number.isFinite(scored)) {
        out.complete = true;
        out.goals_in_timeline = goalsSeen;
        out.goals_in_final_score = scored;
      }
    }
    if (out.complete === undefined && rows.length === FREE_TIER_ROW_CAP) {
      out.complete = null;
      out.truncation_note = `Exactly ${FREE_TIER_ROW_CAP} rows came back, which is also the free tier's cap — this may be a complete ${label} or a truncated one, and from the response alone they are indistinguishable. ${UPGRADE_NOTE}`;
    }
    return out;
  }
  const ev = (await sdbGet(`${base}/lookupevent.php?${new URLSearchParams({ id })}`)
    .then((d) => ((d as { events?: unknown[] | null }).events ?? [])[0] as Record<string, unknown> | undefined)
    // A failed probe is not evidence either way — say we could not tell rather
    // than upgrading an unknown into "this match does not exist".
    .catch(() => undefined));
  if (!ev) {
    return {
      event_id: id,
      found: false,
      reason: 'no_data_and_event_unconfirmed',
      hint: `TheSportsDB returned no ${label} for event ${id}, and the event itself could not be confirmed. Either the id is wrong or the lookup failed — check it with event_detail({event_id: "${id}"}).`,
    };
  }
  return {
    event_id: id,
    found: false,
    reason: `no_${label}_for_event`,
    event: { name: ev.strEvent ?? null, league: ev.strLeague ?? null, date: ev.dateEvent ?? null },
    hint: `The match exists (${String(ev.strEvent ?? id)}${ev.strLeague ? `, ${String(ev.strLeague)}` : ''}) but TheSportsDB carries no ${label} for it. ${label} coverage is per-competition, not universal — this is a gap in the source, not a bad event id.`,
  };
}

async function sdbGet(url: string) {
  // TheSportsDB's free tier enforces a short-window rate limit and 429s under
  // bursts (e.g. the comprehensive sports facet fanning out to multiple teams).
  // A single backoff-retry clears almost all of them since the window is brief.
  let res: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await pwFetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'pipeworx-mcp-thesportsdb/1.0 (+https://pipeworx.io)',
      },
    });
    if (res.status !== 429) break;
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
  }
  if (!res || res.status === 429) throw new Error('TheSportsDB: rate-limit (HTTP 429)');
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
