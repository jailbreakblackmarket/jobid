// Cloudflare Worker: Select first unvisited server and return JobId

const COOLDOWN_TTL = 450; // 7.5 minutes

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let servers;
    try {
      servers = await request.json();
      if (!Array.isArray(servers) || servers.length === 0) {
        return new Response("Invalid server list", { status: 400 });
      }
    } catch {
      return new Response("Bad Request: Invalid JSON", { status: 400 });
    }

    // Make sure KV binding exists
    const kv = env.VISITED_KV;
    if (!kv) {
      return new Response("VISITED_KV not bound", { status: 500 });
    }

    // Loop through provided servers
    for (const server of servers) {
      if (!server.id) continue;

      const visited = await kv.get(server.id);
      if (visited) continue; // skip recently used

      // ✅ Found unvisited server
      await kv.put(server.id, Date.now().toString(), { expirationTtl: COOLDOWN_TTL });
      return new Response(server.id, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // ❌ No suitable servers
    return new Response("NO_SERVER", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  },
};
