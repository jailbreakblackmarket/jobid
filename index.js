// index.js

const PLACE_ID = 606849621; // Replace with your game's place ID
const COOLDOWN_TTL = 450; // 7.5 minutes in seconds (KV uses seconds for TTL)

// Fetch servers from Roblox API
async function getServers(cursor) {
  let url = `https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?sortOrder=Asc&excludeFullGames=true&limit=100`;
  if (cursor) url += `&cursor=${cursor}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch servers");
    return await res.json();
  } catch (err) {
    console.warn("Failed to fetch servers, retrying...", err.message);
    await new Promise(r => setTimeout(r, 100));
    return getServers(cursor);
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

      // Check if jobId is already visited
      const visited = await kv.get(jobId);
      if (playing > 0 && playing <= (maxPlayers - 4) && !visited) {
        // Store jobId in KV with TTL
        await kv.put(jobId, Date.now().toString(), { expirationTtl: COOLDOWN_TTL });
        return jobId;
      }
    }

    if (!data.nextPageCursor) break;
    cursor = data.nextPageCursor;
    await new Promise(r => setTimeout(r, 100)); // small delay
  }

  return null;
}

// Cloudflare Worker fetch handler
export default {
  async fetch(request, env) {
    // env.VISITED_KV must be your KV binding in wrangler.toml
    const kv = env.VISITED_KV;
    const jobId = await findValidServer(kv);

    if (jobId) {
      return new Response(jobId, { headers: { "Content-Type": "text/plain" } });
    } else {
      return new Response("No valid JobId found", { headers: { "Content-Type": "text/plain" } });
    }
  }
};
