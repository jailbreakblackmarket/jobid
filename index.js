// index.js — Cloudflare Worker for finding valid Roblox JobIds with retries

const PLACE_ID = 606849621; // Replace with your game's place ID
const COOLDOWN_TTL = 450; // 7.5 minutes (KV TTL is in seconds)
const RETRY_DELAY = 50; // 3 seconds between retries
const MAX_ATTEMPTS = 500; // safety limit to avoid infinite loop

// Fetch servers from Roblox API
async function getServers(cursor) {
  let url = `https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?sortOrder=Asc&excludeFullGames=true&limit=100`;
  if (cursor) url += `&cursor=${cursor}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Roblox API returned ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn("Failed to fetch servers:", err.message);
    await new Promise((r) => setTimeout(r, 50));
    return getServers(cursor); // retry once on failure
  }
}

// Find a valid server
async function findValidServer(kv) {
  let cursor = null;

  while (true) {
    const data = await getServers(cursor);
    if (!data || !data.data) break;

    for (const server of data.data) {
      const jobId = server.id;
      const playing = server.playing || 0;
      const maxPlayers = server.maxPlayers || 0;
      const status = (server.status || "unknown").toLowerCase();

      // Only accept active/running servers
      if (status !== "running" && status !== "active") continue;

      // Must have at least 1 player and 4 empty slots
      if (playing <= 0 || playing > maxPlayers - 4) continue;

      // Skip recently visited servers
      const visited = await kv.get(jobId);
      if (visited) continue;

      // ✅ Found a valid server
      await kv.put(jobId, Date.now().toString(), { expirationTtl: COOLDOWN_TTL });
      return jobId;
    }

    if (!data.nextPageCursor) break;
    cursor = data.nextPageCursor;
    await new Promise((r) => setTimeout(r, 50)); // small delay between requests
  }

  return null;
}

// Retry loop for robustness
async function getJobIdWithRetry(kv) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const jobId = await findValidServer(kv);
    if (jobId) return jobId;

    console.warn(`Attempt ${attempt}: No valid JobId found. Retrying in ${RETRY_DELAY / 1000}s...`);
    await new Promise((r) => setTimeout(r, RETRY_DELAY));
  }
  return null;
}

// Cloudflare Worker fetch handler
export default {
  async fetch(request, env) {
    const kv = env.VISITED_KV;
    if (!kv) {
      return new Response("Error: VISITED_KV not configured.", { status: 500 });
    }

    // Keep retrying until a valid JobId is found or max attempts reached
    const jobId = await getJobIdWithRetry(kv);

    if (jobId) {
      return new Response(jobId, {
        headers: { "Content-Type": "text/plain" },
      });
    } else {
      return new Response("No valid JobId found after multiple attempts.", {
        headers: { "Content-Type": "text/plain" },
        status: 503,
      });
    }
  },
};
