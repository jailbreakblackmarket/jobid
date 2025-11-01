// Cloudflare Worker: Pick first unvisited server, store it in KV for 7.5 minutes, return JobId as plain text.

const COOLDOWN_TTL = 450; // 7.5 minutes in seconds

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Validate KV binding
    const kv = env.VISITED_KV;
    if (!kv) {
      return new Response("VISITED_KV not configured", { status: 500 });
    }

    // Parse incoming JSON
    let servers;
    try {
      servers = await request.json();
    } catch (e) {
      return new Response("Bad Request: Invalid JSON", { status: 400 });
    }

    if (!Array.isArray(servers) || servers.length === 0) {
      return new Response("No servers received", { status: 400 });
    }

    // Loop through servers and find the first unvisited one
    for (const server of servers) {
      if (!server.id) continue;

      const visited = await kv.get(server.id);
      if (visited) continue; // skip recently used

      // ✅ Found a valid, unvisited server
      await kv.put(server.id, "used", { expirationTtl: COOLDOWN_TTL });

      // Return JobId as plain text (for Lua)
      return new Response(server.id, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // ❌ No unvisited servers found
    return new Response("NO_SERVER", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  },
};
