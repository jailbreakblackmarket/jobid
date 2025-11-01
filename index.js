const TTL = 450; // 7.5 minutes

export default {
  async fetch(req, env) {
    const t = Date.now();
    if (req.method !== "POST") return new Response("Only POST", { status: 405 });

    const kv = env.VISITED_KV;
    if (!kv) {
      console.error("❌ VISITED_KV missing");
      return new Response("KV missing", { status: 500 });
    }

    let servers;
    try { servers = await req.json(); console.log(`📦 ${servers.length} servers`); }
    catch (e) { console.error("❌ Bad JSON", e); return new Response("Bad JSON", { status: 400 }); }

    if (!Array.isArray(servers) || !servers.length) {
      console.warn("⚠️ No servers");
      return new Response("No servers", { status: 400 });
    }

    for (const s of servers) {
      if (!s.id) continue;
      if (await kv.get(s.id)) { console.log("⏩ Skip", s.id); continue; }
      console.log("✅ Picked", s.id);
      await kv.put(s.id, "used", { expirationTtl: TTL });
      return new Response(s.id, { status: 200 });
    }

    console.warn("🚫 No unvisited servers");
    console.log(`⏱️ Done in ${Date.now() - t}ms`);
    return new Response("NO_SERVER", { status: 404 });
  },
};
