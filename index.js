// index.js — Worker that picks the first unused server, caches it for 7.5 minutes, and returns its JobId

const COOLDOWN_TTL = 450; // 7.5 minutes (in seconds)

export default {
  async fetch(request, env) {
    // Only allow POST
    if (request.method !== "POST") {
      return new Response("Use POST to send the server list.", { status: 405 });
    }

    try {
      // Parse JSON body
      const servers = await request.json();
      if (!Array.isArray(servers) || servers.length === 0) {
        return new Response("Invalid or empty server list.", { status: 400 });
      }

      // Loop through all servers and find the first not in KV
      for (const server of servers) {
        const jobId = server.id;
        if (!jobId) continue; // skip malformed data

        const visited = await env.VISITED.get(jobId);
        if (!visited) {
          // Mark as visited for 7.5 minutes
          await env.VISITED.put(jobId, Date.now().toString(), { expirationTtl: COOLDOWN_TTL });

          console.log(`✅ Selected JobId: ${jobId}`);

          // Respond with JobId
          return new Response(jobId, {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        }
      }

      // If all were visited recently
      return new Response("No unvisited servers available.", { status: 404 });
    } catch (err) {
      console.error("❌ Error handling POST:", err);
      return new Response("Failed to process request.", { status: 500 });
    }
  },
};
