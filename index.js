export default {
  async fetch(request, env) {
    const kv = env.SERVERS;

    if (request.method === "POST") {
      const list = await request.json();
      const existing = await kv.list();
      const used = new Set(existing.keys.map(k => k.name));

      for (const s of list) {
        if (s.playing >= 1 && s.playing <= 27 && !used.has(s.id)) {
          await kv.put(s.id, JSON.stringify({ id: s.id, playing: s.playing, t: Date.now() }), { expirationTtl: 450 });
          return new Response(JSON.stringify(s), { headers: { "content-type": "application/json" } });
        }
      }
      return new Response("none", { status: 404 });
    }

    if (request.method === "GET") {
      const list = await kv.list();
      let latestId = null, latestTime = 0;

      for (const k of list.keys) {
        const v = await kv.get(k.name);
        if (v) {
          const s = JSON.parse(v);
          if (s.t > latestTime) {
            latestTime = s.t;
            latestId = s.id;
          }
        }
      }

      return new Response(latestId || "none", {
        headers: { "content-type": "text/plain" },
      });
    }

    return new Response("bad method", { status: 405 });
  },
};
