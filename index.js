// index.js — Tuned Cloudflare Worker for finding valid Roblox JobIds
// Optimized for games with many servers

const PLACE_ID = 606849621; // Replace with your game's Place ID
const COOLDOWN_TTL = 450; // 2 minutes (KV TTL in seconds)
const MAX_PAGES = 50; // safety limit
const MAX_ATTEMPTS = 20; // retry attempts if none found
const RETRY_DELAY_MS = 100; // wait 3s between retries

// Fetch servers from Roblox API with retries and randomized order
async function getServers(cursor, attempt = 1, maxAttempts = 5) {
  const sortOrder = Math.random() > 0.5 ? "Asc" : "Desc";
  let url = `https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?sortOrder=${sortOrder}&excludeFullGames=true&limit=100`;
  if (cursor) url += `&cursor=${cursor}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Roblox API returned ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`❌ Fetch failed (attempt ${attempt}):`, err.message);
    if (attempt >= maxAttempts) {
      console.error("⛔ Max retries reached. Stopping fetch.");
      return null;
    }
    await new Promise((r) => setTimeout(r, 500));
    return getServers(cursor, attempt + 1, maxAttempts);
  }
}

// Find a valid JobId
async function findValidServer(kv) {
  let cursor = null;
  let pagesChecked = 0;

  while (pagesChecked < MAX_PAGES) {
    pagesChecked++;
    const data = await getServers(cursor);
    if (!data || !data.data || data.data.length === 0) {
      console.warn("⚠️ No data received from Roblox API.");
      break;
    }

    console.log(`📄 Page ${pagesChecked}: ${data.data.length} servers`);

    for (const server of data.data) {
      const jobId = server.id;
      const playing = server.playing || 0;
      const maxPlayers = server.maxPlayers || 0;
      const status = (server.status || "unknown").toLowerCase();

      // Log summary
      console.log(`🕹️  Server ${jobId}: ${playing}/${maxPlayers}, status=${status}`);

      // Skip reserved or closing servers
      if (status.includes("reserved") || status.includes("closing")) {
        console.log(`⏩ Skipping ${jobId} (status=${status})`);
        continue;
      }

      // Skip empty or full servers
      if (playing <= 0) {
        console.log(`⏩ Skipping ${jobId} (empty)`);
        continue;
      }
      if (playing >= maxPlayers) {
        console.log(`⏩ Skipping ${jobId} (full)`);
        continue;
      }

      // Skip recently visited servers
      const visited = await kv.get(jobId);
      if (visited) {
        console.log(`⏩ Skipping ${jobId} (recently visited)`);
        continue;
      }

      // ✅ Found valid server
      console.log(`✅ Valid server found: ${jobId} (${playing}/${maxPlayers}, status=${status})`);
      await kv.put(jobId, Date.now().toString(), { expirationTtl: COOLDOWN_TTL });
      return jobId;
    }

    // No more pages
    if (!data.nextPageCursor) {
      console.warn("⚠️ No next page cursor, reached end of results.");
      break;
    }

    cursor = data.nextPageCursor;
    await new Promise((r) => setTimeout(r, 500));
  }

  console.warn(`🚫 Checked ${pagesChecked} pages, no valid server found.`);
  return null;
}

// Retry logic — keeps searching until one is found
async function getJobIdWithRetry(kv) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const jobId = await findValidServer(kv);
    if (jobId) return jobId;

    console.log(`🔁 Attempt ${attempt}: No JobId found. Retrying in ${RETRY_DELAY_MS / 1000}s...`);
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }

  console.error("❌ Max attempts reached, still no valid JobId found.");
  return null;
}

// Cloudflare Worker entrypoint
export default {
  async fetch(request, env) {
    const kv = env.VISITED_KV;
    if (!kv) {
      return new Response("❌ Error: VISITED_KV not configured.", { status: 500 });
    }

    console.log("🚀 Searching for a valid JobId...");
    const jobId = await getJobIdWithRetry(kv);

    if (jobId) {
      console.log(`🎯 Returning JobId: ${jobId}`);
      return new Response(jobId, { headers: { "Content-Type": "text/plain" } });
    } else {
      console.log("😞 No valid JobId found after retries.");
      return new Response("No valid JobId found right now.", {
        headers: { "Content-Type": "text/plain" },
        status: 503,
      });
    }
  },
};
