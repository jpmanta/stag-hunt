// Real-time hub: one Durable Object holds every member's WebSocket and fans out
// presence and "something changed" events.
import { DurableObject } from "cloudflare:workers";

export class Hub extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      const member = JSON.parse(request.headers.get("X-Member"));
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment(member);
      this.presence();
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === "/broadcast") {
      // A message with `_to` (member ids) goes only to those members.
      let s = await request.text(), to = null;
      try { const m = JSON.parse(s); if (Array.isArray(m._to)) { to = new Set(m._to); delete m._to; s = JSON.stringify(m); } } catch {}
      this.broadcast(s, to);
      return new Response("ok");
    }
    if (url.pathname === "/kick") {
      const { user_id, reconnect } = await request.json();
      for (const ws of this.ctx.getWebSockets()) {
        if (ws.deserializeAttachment()?.id === user_id) try { ws.close(reconnect ? 4002 : 4001, reconnect ? "role" : "removed"); } catch {}
      }
      this.presence();
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws, data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === "ping") ws.send('{"type":"pong"}');
  }

  webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code); } catch {}
    this.presence();
  }
  webSocketError() { this.presence(); }

  presence() {
    const ids = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState === 1) { const m = ws.deserializeAttachment(); if (m && !m.observer) ids.add(m.id); }
    }
    this.broadcast(JSON.stringify({ type: "presence", online: [...ids] }));
  }

  broadcast(s, to) {
    for (const ws of this.ctx.getWebSockets()) {
      if (to && !to.has(ws.deserializeAttachment()?.id)) continue;
      try { ws.send(s); } catch {}
    }
  }
}
