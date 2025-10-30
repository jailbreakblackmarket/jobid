// index.js — Cloudflare Worker for finding valid Roblox JobIds

const PLACE_ID = 606849621; // Replace with your game's place ID
const COOLDOWN_TTL = 450; // 7.5 minutes (KV TTL is in seconds)

// Fetch servers from Roblox API
async function getServers(cursor, attempt = 1, maxAttempts = 5) {
  let url = `https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?sortOrder=Asc&excludeFullGames=true&limit=100`;
  if (cursor) url += `&cursor=${cursor}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Roblox API returned ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`Fetch failed (attempt ${attempt}):`, err.message);
    if (attempt >= maxAttempts) {
      console.error("Max retries reached. Stopping fetch.");
      return null; // give up
    }
    await new Promise((r) => setTimeout(r, 100)); // wait 0.5s before retry
    return getServers(cursor, attempt + 1, maxAttempts);
  }
}

// Find a valid server
async function findValidServer(kv) {
  let cursor = null;
  let pagesChecked = 0;
  const MAX_PAGES = 50; // safety limit

  while (pagesChecked < MAX_PAGES) {
    pagesChecked++;
    const data = await getServers(cursor);
    if (!data || !data.data) break;

    for (const server of data.data) {
      const jobId = server.id;
      const playing = server.playing || 0;
      const maxPlayers = server.maxPlayers || 0;
      const status = (server.status || "unknown").toLowerCase();

      if (status !== "running" && status !== "active") continue;
      if (playing <= 0 || playing > maxPlayers - 4) continue;

      const visited = await kv.get(jobId);
      if (visited) continue;

      await kv.put(jobId, Date.now().toString(), { expirationTtl: COOLDOWN_TTL });
      return jobId;
    }

    if (!data.nextPageCursor) break;
    cursor = data.nextPageCursor;
    await new Promise((r) => setTimeout(r, 500));
  }

  console.warn("Stopped after max pages checked:", pagesChecked);
  return null;
}

// Cloudflare Worker fetch handler
export default {
  async fetch(request, env) {
    const kv = env.VISITED_KV;
    if (!kv) {
      return new Response("Error: VISITED_KV not configured.", { status: 500 });
    }

    const jobId = await findValidServer(kv);

    if (jobId) {
      return new Response(jobId, {
        headers: { "Content-Type": "text/plain" },
      });
    } else {
      return new Response("No valid JobId found right now.", {
        headers: { "Content-Type": "text/plain" },
      });
    }
  },
};
