// index.js — Cloudflare Worker for finding valid Roblox JobIds safely
// Handles Roblox rate limits gracefully with adaptive backoff

const PLACE_ID = 606849621; // Replace with your game's Place ID
const COOLDOWN_TTL = 450;   // 2 minutes (KV TTL in seconds)
const MAX_PAGES = 40;       // Max number of pages per run
const BASE_DELAY = 1000;    // 1s between page requests
const RETRY_DELAY = 1000;   // 5s between retry loops
const MAX_ATTEMPTS = 10;    // Number of full search retries

// Utility sleep
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Fetch servers from Roblox API with safe rate limit handling
async function getServers(cursor, attempt = 1) {
  const sortOrder = Math.random() > 0.5 ? "Asc" : "Desc";
  let url = `https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?sortOrder=${sortOrder}&excludeFullGames=true&limit=100`;
  if (cursor) url += `&cursor=${cursor}`;

  try {
    const res = await fetch(url);

    if (res.status === 429) {
      console.warn("⚠️ Hit Roblox rate limit (HTTP 429). Backing off 10s...");
      await sleep(10000);
      return getServers(cursor, attempt + 1);
    }

    if (!res.ok) throw new Error(`Roblox API returned ${res.status}`);
    return await res.json();

  } catch (err) {
    console.warn(`❌ Fetch failed (attempt ${attempt}): ${err.message}`);
    if (attempt >= 5) {
      console.error("⛔ Max fetch attempts reached — giving up this page.");
      return null;
    }
    await sleep(2000 * attempt); // exponential backoff
    return getServers(cursor, attempt + 1);
  }
}

// Core: find a valid server
async function findValidServer(kv) {
  let cursor = null;
  let pagesChecked = 0;

  while (pagesChecked < MAX_PAGES) {
    pagesChecked++;
    console.log(`📄 Fetching page ${pagesChecked}...`);
    const data = await getServers(cursor);
    if (!data || !data.data) {
      console.warn("⚠️ No data returned (possible throttle or empty).");
      break;
    }

    for (const server of data.data) {
      const jobId = server.id;
      const playing = server.playing ?? 0;
      const maxPlayers = server.maxPlayers ?? 0;
      const status = (server.status ?? "unknown").toLowerCase();

      console.log(`🕹️ ${jobId}: ${playing}/${maxPlayers}, status=${status}`);

      // Skip non-playable servers
      if (status.includes("reserved") || status.includes("closing")) continue;
      if (playing <= 0 || playing >= maxPlayers) continue;

      // Skip recently visited
      const visited = await kv.get(jobId);
      if (visited) continue;

      // ✅ Valid server found
      console.log(`✅ Valid server: ${jobId}`);
      await kv.put(jobId, Date.now().toString(), { expirationTtl: COOLDOWN_TTL });
      return jobId;
    }

    // Go to next page if available
    if (!data.nextPageCursor) {
      console.log("⚠️ No next page cursor — end of list.");
      break;
    }

    cursor = data.nextPageCursor;
    await sleep(BASE_DELAY); // delay to stay under rate limit
  }

  console.warn(`🚫 Checked ${pagesChecked} pages — no valid JobId found.`);
  return null;
}

// Retry wrapper — will back off between full searches
async function getJobIdWithRetry(kv) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`🔁 Search attempt ${attempt}...`);
    const jobId = await findValidServer(kv);
    if (jobId) return jobId;

    console.warn(`⏳ No JobId yet — waiting ${RETRY_DELAY / 1000}s before retry...`);
    await sleep(RETRY_DELAY);
  }
  console.error("❌ Out of attempts — no valid JobId found.");
  return null;
}

// Cloudflare Worker handler
export default {
  async fetch(request, env) {
    const kv = env.VISITED_KV;
    if (!kv) {
      return new Response("❌ VISITED_KV not configured.", { status: 500 });
    }

    console.log("🚀 Starting Roblox JobId search...");
    const jobId = await getJobIdWithRetry(kv);

    if (jobId) {
      return new Response(jobId, { headers: { "Content-Type": "text/plain" } });
    } else {
      return new Response("No valid JobId found right now.", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      });
    }
  },
};
