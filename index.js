// index.js — Cloudflare Worker for Roblox server selection with full logging

const COOLDOWN_TTL = 450; // 7.5 minutes (in seconds)
const MAX_RETRIES = 3; // retry attempts if all servers visited

export default {
  async fetch(request, env, ctx) {
    const start = Date.now();

    // Only allow POST
    if (request.method !== "POST") {
      console.log("❌ Invalid method:", request.method);
      return new Response("Use POST to send the server list.", { status: 405 });
    }

    try {
      // Parse incoming JSON body
      const servers = await request.json();
      console.log(`📦 Received request with ${servers.length || 0} servers`);

      if (!Array.isArray(servers) || servers.length === 0) {
        console.warn("⚠️ No servers provided or invalid JSON");
        return new Response("Invalid or empty server list.", { status: 400 });
      }

      // Loop with retries
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`🔁 Attempt ${attempt} to find unvisited server...`);

        for (const server of servers) {
          const jobId = server.id;
          if (!jobId) {
            console.warn("⚠️ Skipping malformed server (missing id)");
            continue;
          }

          const visited = await env.VISITED.get(jobId);
          if (visited) {
            console.log(`⏩ Skipping visited server: ${jobId}`);
            continue;
          }

          // ✅ Found a new one
          await env.VISITED.put(jobId, Date.now().toString(), {
            expirationTtl: COOLDOWN_TTL,
          });

          const duration = (Date.now() - start) / 1000;
          console.log(`✅ Selected JobId: ${jobId} | playing=${server.playing || 0} | took ${duration.toFixed(2)}s`);

          // Return successful response
          return new Response(
            JSON.stringify({
              id: jobId,
              playing: server.playing || 0,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        console.warn(`⚠️ All servers visited (attempt ${attempt}/${MAX_RETRIES}), retrying in 2s...`);
        await new Promise((r) => setTimeout(r, 2000));
      }

      console.error("🚫 No unvisited servers after all retries.");
      return new Response("No valid unvisited servers available.", { status: 404 });
    } catch (err) {
      console.error("❌ Error during request:", err);
      return new Response("Internal server error", { status: 500 });
    }
  },
};
