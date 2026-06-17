Spark AI Kit - Vidlet
https://sparkbrain.app/docs

FILES
  spark-ai.tsx    Core: configure, useAi, AiWand, AiInput, AiTextarea
  wands.tsx       Specialized: AiRephraseWand, AiLimitsWand, AiReviseFeatures,
                  AiComparisonWand, AiConfirmWand
  spark-ai.css    Styles for wand animations, tooltips, field wrappers.

HOW IT WORKS
  The kit calls sparkbrain.app's API directly - no server code needed on your end.
  All heavy lifting (AI, prompts, search, rate limiting) runs on our backend.
  Auth is automatic via your domain in production.

  CORS: The sparkbrain.app API handles CORS server-side. Registered domains work
  automatically via Origin header. For localhost, use the API key approach below.

SETUP
  1. Copy these files into your project (e.g. lib/spark-ai/).
  2. Your domain (vidlet.app) is already registered.
  3. Import and use.

  IMPORTANT: configure() must be called BEFORE any component using useAi()
  mounts. In Next.js App Router, call it at module scope in a layout or
  provider file - NOT inside a useEffect:

    // app/providers.tsx (module scope)
    import { configure } from './spark-ai';
    configure({ apiKey: process.env.NEXT_PUBLIC_SPARK_AI_API_KEY });

    // Then import providers.tsx in your layout

QUICK START

  import { AiWand, AiInput, AiTextarea, useAi } from './spark-ai';
  import { AiRephraseWand, AiComparisonWand } from './wands';
  import type { ComparisonResponse } from './wands';

  -- AI wand button --
  <AiWand
    tooltip="Improve"
    prompt={(v) => `Improve this: ${v}`}
    value={text}
    onResult={setText}
  />

  -- Input with built-in wand --
  <AiInput
    value={title}
    onChange={setTitle}
    prompt={(v) => `Improve this title: "${v}"`}
    placeholder="Product name"
  />

  -- Textarea with wand (wand appears top-right) --
  <AiTextarea
    value={description}
    onChange={setDescription}
    prompt="Make this description more compelling"
    rows={4}
  />

  -- Wand with dropdown actions menu --
  <AiWand
    tooltip="AI actions"
    prompt="Improve this text"
    value={text}
    onResult={setText}
    actions={[
      { label: 'Shorten', prompt: (v) => `Shorten: ${v}` },
      { label: 'Expand',  prompt: (v) => `Expand: ${v}` },
    ]}
  />

  -- Rephrase wand (backend handles the prompt) --
  <AiRephraseWand value={text} onChange={setText} />

  -- Competitor comparison table --
  <AiComparisonWand appName="Vidlet" domain="vidlet.app" />

  -- Programmatic access --
  const { available, loading, ask, action, cancel } = useAi();

  // ask() returns { reply } on success or { error, status? } on failure
  const result = await ask('Summarize this');
  if ('error' in result) {
    console.error(result.error, result.status); // e.g. "Rate limit exceeded", 429
  } else {
    console.log(result.reply);
  }

  // action() returns { type, result } on success or { error, status? } on failure
  const r = await action('rephrase', { value: 'Some text' });
  if ('error' in r) {
    console.error(r.error);
  } else {
    console.log(r.result);
  }

  -- Structured JSON output --
  const json = await action('structured-output', {
    prompt: 'Extract name, email, and role from this text',
    context: 'Alice (alice@acme.co) is the lead designer',
  });
  // -> { type: 'json', result: { name: 'Alice', email: 'alice@acme.co', role: 'lead designer' } }
  // NOTE: The AI may not match your expected schema exactly. Always validate
  // the result shape defensively (e.g. check for arrays vs objects).

API REFERENCE

  configure(opts)
    Call once at app startup BEFORE any useAi() hook mounts.
    In production (registered domain), configure() is not needed - auth uses Origin.
    opts.apiKey    string   API key for local dev / domainless access.
    opts.baseUrl   string   Override API base URL (default: https://sparkbrain.app).

  useAi() -> { available, loading, ask, action, cancel }
    React hook. Returns:
    available   boolean | null   null while checking, true if AI is enabled.
    loading     boolean          true while any request is in flight.
    ask         (message: string, kit?: boolean) => Promise<{ reply } | AiError>
                Free-form text prompt. Returns { reply: string } on success.
                Returns { error: string, status?: number } on failure.
                The optional `kit` parameter (default false) enables kit-mode
                prompting on the backend.
    action      <T>(name, params) => Promise<{ type, result: T } | AiError>
                Call a structured backend action (see Actions below).
                Returns { error, status } on failure (401, 403, 429, 500, etc).
    cancel      () => void
                Aborts ALL in-flight requests (both ask and action calls).
                Each ask/action call has its own AbortController, so concurrent
                calls do not cancel each other. cancel() aborts all of them.

  AiError (type, exported from spark-ai.tsx)
    error    string          Human-readable error message.
    status   number | undefined
             HTTP status code if available (401=unauthorized, 403=forbidden,
             429=rate limited, 500=server error, 0=aborted).

  ERROR HANDLING
    The API may return these HTTP status codes:
    - 401: Invalid or missing API key
    - 403: Domain not registered, app inactive, or tier restriction
    - 429: Rate limit exceeded (check Retry-After header if present)
    - 500: Internal server error
    - 502: AI service temporarily unavailable

    All errors are returned as { error, status } objects. Check with:
      if ('error' in result) { /* handle error */ }

  AiWand
    Sparkle button that sends a prompt to the AI on click.
    tooltip      string             Hover tooltip text. Required.
    prompt       string | (v) => s  Prompt template. Receives value. Required.
    value        string             Current field value passed to prompt. Default "".
    onResult     (text) => void     Called with the AI reply.
    actions      AiAction[]         Dropdown menu of alternative prompts.
    cacheSize    number             Cache up to N responses; cycle through on re-click.
                                    NOTE: when the cache is full, clicking the wand
                                    cycles through cached responses instead of making
                                    a new AI request. Set to 0 (default) for always-fresh.
    className    string             Additional CSS classes.

  AiAction (type for the actions prop)
    label    string                  Menu item label.
    prompt   string | (v) => s       Prompt template.
    icon     React component         Optional icon (default: Sparkles).

  AiInput
    Input field with a built-in AiWand. Accepts all <input> HTML attributes.
    value        string             Controlled value. Required.
    onChange     (v) => void         Value change handler. Required.
    prompt       string | (v) => s  Prompt template. Required.
    actions      AiAction[]         Dropdown menu of alternative prompts.
    wandTooltip  string             Wand tooltip (default: "AI: improve").

  AiTextarea
    Same as AiInput but renders a <textarea>. Wand appears at the top-right.
    Accepts all <textarea> HTML attributes plus the same AI props as AiInput.

  AiRephraseWand
    Backend action wand. Rephrases text professionally.
    value      string           Text to rephrase. Required.
    onChange   (v) => void      Receives the rephrased text. Required.
    className  string           Additional CSS classes.
    onError    (msg) => void    Called on failure with error message.
    onLoading  (busy) => void   Called with true/false for loading state.

  AiLimitsWand
    Infers realistic per-tier usage limits for a pricing page.
    plans      { name, price }[]                Plan tiers. Required.
    appName    string                           App name for context. Required.
    onResult   (limits: { Tier: string[] }) => void   Receives inferred limits. Required.
    tooltip    string                           Hover tooltip.
    onError    (msg) => void                    Called on failure.
    onLoading  (busy) => void                   Called with loading state.

  AiReviseFeatures
    Rewrites plan features to be concise and benefit-focused.
    planName   string           Plan name. Required.
    features   string[]         Current feature list. Required.
    onResult   (revised: string[]) => void   Receives revised features. Required.
    tooltip    string           Hover tooltip.
    onError    (msg) => void    Called on failure.
    onLoading  (busy) => void   Called with loading state.

  AiComparisonWand
    Fetches and displays a competitor comparison table in a modal.
    Uses Tavily Research API to find up to 3 direct competitors and build
    a feature-by-feature comparison table with pricing, insights, and
    competitor favicons. Results are cached in the database for 24 hours.
    Includes a 90-second timeout on the network request.
    appName    string   App name. Required.
    domain     string   App domain for search context.
    tooltip    string   Hover tooltip.
    onResult   (data: ComparisonResponse) => void   Called on success.
    onError    (msg) => void                        Called on failure.
    onLoading  (busy) => void                       Called with loading state.

  AiConfirmWand
    Two-step wand: shows a confirmation message before firing.
    prompt          string | (v) => s   Prompt to send on confirm. Required.
    value           string              Value passed to prompt function. Default "".
    onResult        (text) => void      Receives the AI reply. Required.
    message         string              Confirmation message shown. Required.
    tooltip         string              Initial button tooltip.
    proceedTooltip  string              Confirm button tooltip.

  ComparisonResponse (exported type from wands.tsx)
    domain       string
    app          { name, icon }
    competitors  { name, url, icon }[]
    rows         { feature, ours, competitors[] }[]
    insights     string

COMPETITOR SEARCH API

  POST /api/ai/competitor-search
  Headers: X-Api-Key (or Origin-based auth in production)
  Body: { "appName": "Vidlet", "domain": "vidlet.app" }

  Returns pure JSON. Client handles rendering (see ComparisonTable in
  wands.tsx for the reference dark-theme implementation).

  How it works (Tavily-first, AI-last):
    1. DB cache: returns cached result if < 24 hours old (instant, pre-auth)
    2. Product context: DB config, SparkPay plans, or deep Tavily Extract
       crawl of homepage + pricing page for feature data
    3. Tavily Research: finds competitors with structured output
    4. Tavily Extract (advanced): crawls competitor homepage + /pricing;
       falls back to Tavily Search for thin data
    5. AI formatting (70B model): extracts comparable features into
       8-12 normalized rows (yes/no, numbers, prices)
    6. Zod validation + dedup + promo filtering + value normalization
    7. Cached in DB for 24 hours

  Response:
  {
    "domain": "vidlet.app",
    "app": { "name": "Vidlet", "icon": "https://vidlet.app/favicon.ico" },
    "competitors": [
      { "name": "Rival", "url": "https://rival.com", "icon": "https://rival.com/favicon.ico" }
    ],
    "rows": [
      { "feature": "Pricing", "ours": "$10/mo", "competitors": ["$12/mo"] }
    ],
    "insights": "One concise sentence."
  }

  Icon URLs point to each domain's /favicon.ico. Use the Google fallback
  (https://www.google.com/s2/favicons?domain=DOMAIN&sz=32) as onerror.

  For best results, configure your app's description and features in the
  dashboard (or set up SparkPay plans). Without it, the API deep-crawls
  your domain to extract feature data automatically.

  Programmatic usage:
    const res = await fetch('https://sparkbrain.app/api/ai/competitor-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'your-key' },
      body: JSON.stringify({ appName: "Vidlet", domain: 'vidlet.app' }),
    });
    const { app, competitors, rows, insights } = await res.json();

ACTIONS REFERENCE

  action('rephrase', { value })
    Rephrase text professionally. Returns { type: 'text', result }.

  action('infer-limits', { appName, plans: [{ name, price }] })
    Infer per-tier usage limits. Returns { type: 'json', result: { TierName: [...] } }.

  action('revise-features', { planName, features: [...] })
    Rewrite plan features to be concise and benefit-focused.
    Returns { type: 'json', result: [...] }.

  action('structured-output', { prompt, context? })
    Ask the AI to return structured JSON. The prompt should describe the desired
    schema and task. Optional context supplies source data (CSV, text, etc.).
    Retries once automatically if the first response is not valid JSON.
    Returns { type: 'json', result } on success, { type: 'text', result } on failure.
    NOTE: The result may not exactly match the schema you described. The AI might
    return a single object when you asked for an array, or wrap data in an
    unexpected key. Always validate the shape of result defensively.

  All actions return { error, status } on failure instead of the success shape.
  Check with: if ('error' in result) { /* handle */ }
