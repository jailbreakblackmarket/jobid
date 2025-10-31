export default {
  async fetch(request, env) {
    const kv = env.SERVERS;
    console.log("🔹 Request received:", request.method);

    if (request.method === "POST") {
      try {
        const list = await request.json();
        console.log("📦 Received server list:", list.length, "entries");

        const existing = await kv.list();
        console.log("🗝️ Existing keys in KV:", existing.keys.length);

        const used = new Set(existing.keys.map(k => k.name));

        for (const s of list) {
          console.log("➡️ Checking server:", s.id, "players:", s.playing);

          if (s.playing >= 1 && s.playing <= 27 && !used.has(s.id)) {
            console.log("✅ Selected server:", s.id);

            await kv.put(
              s.id,
              JSON.stringify({ id: s.id, playing: s.playing, t: Date.now() }),
              { expirationTtl: 450 }
            );

            console.log("💾 Stored server", s.id, "in KV (TTL 450s)");
            return new Response(s.id, {
              headers: { "content-type": "text/plain" },
            });
          }
        }

        console.log("❌ No valid servers found in list.");
        return new Response("none", { status: 404 });
      } catch (err) {
        console.error("🚨 Error handling POST:", err);
        return new Response("error", { status: 500 });
      }
    }

    console.warn("⚠️ Unsupported method:", request.method);
    return new Response("Only POST supported", { status: 405 });
  },
};
