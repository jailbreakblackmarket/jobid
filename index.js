// index.js — Debug version for finding valid Roblox JobIds with detailed logging

const PLACE_ID = 606849621; // Replace with your game's place ID
const COOLDOWN_TTL = 450; // 7.5 minutes (KV TTL is in seconds)
const MAX_PAGES = 50; // Prevent infinite loops
const MAX_ATTEMPTS = 5; // Max fetch retries

// Fetch servers from Roblox API (with retries)
async function getServers(cursor, attempt = 1) {
  let url = `https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?sortOrder=Asc&excludeFullGames=true&limit=100`;
  if (cursor) url += `&cursor=${cursor}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Roblox API returned ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`❌ Fetch failed (attempt ${attempt}):`, err.message);
    if (attempt >= MAX_ATTEMPTS) {
      console.error("⛔ Max retries reached. Stopping fetch.");
      return null;
    }
    await new Promise((r) => setTimeout(r, 100));
    return getServers(cursor, attempt + 1);
  }
}

// Find a valid server (with detailed logging)
async function findValidServer(kv) {
  let cursor = null;
  let pagesChecked = 0;

  while (pagesChecked < MAX_PAGES) {
    pagesChecked++;
    const data = await getServers(cursor);
    if (!data || !data.data) {
      console.warn("⚠️ No data received from Roblox API.");
      break;
    }

    console.log(`📄 Page ${pagesChecked} contains ${data.data.length} servers.`);

    for (const server of data.data) {
      const jobId = server.id;
      const playing = server.playing || 0;
      const maxPlayers = server.maxPlayers || 0;
      const status = (server.status || "unknown").toLowerCase();

      // Log basic info
      console.log(`🕹️  Server ${jobId}: ${playing}/${maxPlayers} | status=${status}`);

      // Skip non-running servers
      if (status.includes("reserved") || status.includes("closing")) {
        console.log(`⏩ Skipping ${jobId} (status=${status})`);
        continue;
      }

      // Skip empty or full servers
      if (playing <= 0) {
        console.log(`⏩ Skipping ${jobId} (empty server)`);
        continue;
      }
      if (playing >= maxPlayers) {
        console.log(`⏩ Skipping ${jobId} (full server)`);
        continue;
      }

      // Skip recently visited
      const visited = await kv.get(jobId);
      if (visited) {
        console.log(`⏩ Skipping ${jobId} (recently visited)`);
        continue;
      }

      // ✅ Found a valid one
      console.log(`✅ Found valid server: ${jobId} (${playing}/${maxPlayers}, status=${status})`);
      await kv.put(jobId, Date.now().toString(), { expirationTtl: COOLDOWN_TTL });
      return jobId;
    }

    if (!data.nextPageCursor) {
      console.warn("⚠️ No next page cursor. Reached end of results.");
      break;
    }

    cursor = data.nextPageCursor;
    await new Promise((r) => setTimeout(r, 500));
  }

  console.warn(`🚫 Stopped after checking ${pagesChecked} page(s) — no valid JobId found.`);
  return null;
}

// Cloudflare Worker entrypoint
export default {
  async fetch(request, env) {
    const kv = env.VISITED_KV;
    if (!kv) {
      return new Response("❌ Error: VISITED_KV not configured.", { status: 500 });
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
