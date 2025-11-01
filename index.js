// Cloudflare Worker — Selects first unvisited server, stores in KV for 7.5 mins, returns JobId.

const COOLDOWN_TTL = 450; // 7.5 minutes (in seconds)

export default {
  async fetch(request, env) {
    const start = Date.now();
    console.log("📥 Incoming request:", request.method, request.url);

    if (request.method !== "POST") {
      console.warn("❌ Rejected non-POST request.");
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Ensure KV namespace is available
    const kv = env.VISITED_KV;
    if (!kv) {
      console.error("❌ VISITED_KV is not configured.");
      return new Response("VISITED_KV not configured", { status: 500 });
    }

    // Parse incoming JSON body
    let servers;
    try {
      servers = await request.json();
      console.log(`📦 Received ${servers.length} servers from client.`);
    } catch (e) {
      console.error("❌ Failed to parse JSON:", e.message);
      return new Response("Bad Request: Invalid JSON", { status: 400 });
    }

    if (!Array.isArray(servers) || servers.length === 0) {
      console.warn("⚠️ No servers provided in request body.");
      return new Response("No servers received", { status: 400 });
    }

    // Find first unvisited server
    for (const [i, server] of servers.entries()) {
      if (!server.id) {
        console.log(`⏩ Server #${i + 1} skipped (missing ID).`);
        continue;
      }

      const visited = await kv.get(server.id);
      if (visited) {
        console.log(`⏩ Skipping ${server.id} (recently used).`);
        continue;
      }

      // ✅ Found unvisited server
      console.log(`✅ Selected new server: ${server.id} (${server.playing || "?"} players)`);
      await kv.put(server.id, "used", { expirationTtl: COOLDOWN_TTL });

      console.log(`🕒 Stored ${server.id} in KV for ${COOLDOWN_TTL}s.`);
      console.log(`⏱️ Completed in ${Date.now() - start}ms.`);
      return new Response(server.id, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // ❌ No valid unvisited servers
    console.warn("🚫 No unvisited servers found.");
    console.log(`⏱️ Completed in ${Date.now() - start}ms.`);

    return new Response("NO_SERVER", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  },
};
