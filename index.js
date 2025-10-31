export default {
  async fetch(request, env) {
    const kv = env.SERVERS;

    if (request.method === "POST") {
      const list = await request.json();
      const existing = await kv.list();
      const used = new Set(existing.keys.map(k => k.name));

      for (const s of list) {
        if (s.playing >= 1 && s.playing <= 27 && !used.has(s.id)) {
          await kv.put(
            s.id,
            JSON.stringify({ id: s.id, playing: s.playing, t: Date.now() }),
            { expirationTtl: 450 }
          );

          // ✅ return only the server ID as plain text
          return new Response(s.id, {
            headers: { "content-type": "text/plain" },
          });
        }
      }

      return new Response("none", { status: 404 });
    }

    return new Response("Only POST supported", { status: 405 });
  },
};
