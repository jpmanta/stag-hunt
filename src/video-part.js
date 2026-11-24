// A video is asked for in parts ("Range: bytes=0-1"). Safari, and so every iPhone, will not play a video
// unless the answer is "206 Partial Content" with just that part. The static file store answers a part
// request with the whole file, so the part is cut here. Only .mp4 files asked for with a Range header come
// this way (see handle in index.js). Anything unexpected falls back to the plain file.
// No imports, so Node can test it.
export async function videoPart(request, env) {
  try {
    const headers = new Headers(request.headers);
    for (const h of ["range", "if-range", "if-none-match", "if-modified-since"]) headers.delete(h);
    const whole = await env.ASSETS.fetch(new Request(request.url, { method: "GET", headers }));
    const m = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get("range") || "").trim());
    if (whole.status !== 200 || !m || (m[1] === "" && m[2] === "")) return whole;
    // "If-Range": the browser has an older copy and wants the part only if the file is unchanged.
    const ifRange = request.headers.get("if-range");
    if (ifRange && ifRange !== whole.headers.get("etag") && ifRange !== whole.headers.get("last-modified")) return whole;

    const bytes = new Uint8Array(await whole.arrayBuffer());
    const size = bytes.length;
    let start, end;
    if (m[1] === "") { start = Math.max(0, size - Number(m[2])); end = size - 1; }   // "the last N bytes"
    else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }

    const out = new Headers(whole.headers);
    out.set("Accept-Ranges", "bytes");
    out.delete("Content-Encoding");
    if (size === 0 || start >= size || start > end) {
      out.set("Content-Range", `bytes */${size}`);
      out.delete("Content-Length");
      return new Response(null, { status: 416, headers: out });
    }
    out.set("Content-Range", `bytes ${start}-${end}/${size}`);
    out.set("Content-Length", String(end - start + 1));
    return new Response(request.method === "HEAD" ? null : bytes.subarray(start, end + 1), { status: 206, headers: out });
  } catch (err) {
    console.error("video part", (err && err.stack) || err);
    return env.ASSETS.fetch(request);
  }
}
