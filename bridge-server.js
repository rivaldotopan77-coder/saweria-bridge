// SAWERIA BRIDGE - menerima webhook Saweria, disajikan ke Roblox lewat /poll
// Tanpa dependency (hanya Node.js bawaan). Butuh Node 18+.
//
// ENV yang wajib diisi di hosting:
//   ROBLOX_KEY     = kunci rahasia, harus SAMA dengan ROBLOX_KEY di SaweriaServer.lua
//   WEBHOOK_TOKEN  = kunci rahasia untuk URL webhook Saweria
//
// URL webhook yang ditempel di Saweria (tab Webhook):
//   https://ALAMAT-HOSTING-KAMU/saweria?token=ISI_WEBHOOK_TOKEN

const http = require("http");

const PORT = process.env.PORT || 3000;
const ROBLOX_KEY = process.env.ROBLOX_KEY || "";
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";
const MAX_EVENTS = 200;

let seq = 0;
const events = [];          // { seq, t, name, amount, message }
const seenIds = new Set();  // cegah donasi dobel

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(body);
}

function readBody(req, limit = 100000) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > limit) { reject(new Error("body terlalu besar")); req.destroy(); }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function parseDonation(b) {
  const etc = b.etc || {};
  const name = String(b.donator_name || b.donatur || b.name || "Seseorang").slice(0, 40);
  const amount = Math.floor(Number(b.amount_raw ?? b.amount ?? etc.amount_to_display ?? 0)) || 0;
  const message = String(b.message || "").slice(0, 200);
  return { id: b.id ? String(b.id) : null, name, amount, message };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/") {
    return send(res, 200, { ok: true, last: seq });
  }

  // === Saweria -> bridge ===
  if (req.method === "POST" && url.pathname === "/saweria") {
    if (!WEBHOOK_TOKEN || url.searchParams.get("token") !== WEBHOOK_TOKEN) {
      return send(res, 401, { error: "token salah" });
    }
    try {
      const raw = await readBody(req);
      const d = parseDonation(JSON.parse(raw || "{}"));
      if (d.amount <= 0) return send(res, 200, { ignored: true });
      if (d.id && seenIds.has(d.id)) return send(res, 200, { duplicate: true });
      if (d.id) { seenIds.add(d.id); if (seenIds.size > 500) seenIds.delete(seenIds.values().next().value); }

      seq += 1;
      events.push({ seq, t: Date.now(), name: d.name, amount: d.amount, message: d.message });
      while (events.length > MAX_EVENTS) events.shift();
      console.log(`[saweria] #${seq} ${d.name} Rp${d.amount}`);
      return send(res, 200, { ok: true, seq });
    } catch (e) {
      console.log("[saweria] payload error:", e.message);
      return send(res, 400, { error: "payload tidak valid" });
    }
  }

  // === Roblox -> bridge ===
  if (req.method === "GET" && url.pathname === "/poll") {
    if (!ROBLOX_KEY || url.searchParams.get("key") !== ROBLOX_KEY) {
      return send(res, 401, { error: "key salah" });
    }
    const after = url.searchParams.get("after");
    if (after === "now") return send(res, 200, { last: seq, events: [] });
    const n = Number(after) || 0;
    return send(res, 200, { last: seq, events: events.filter((e) => e.seq > n) });
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, () => console.log("Saweria bridge jalan di port " + PORT));
