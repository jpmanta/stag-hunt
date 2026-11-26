// How long a browser may keep a static file before asking for it again.
// Fonts never change, so they are kept for a year. Pictures, videos and captions are kept for a day,
// so replaying a video or coming back to a page does not download it again.
// Pages, scripts and styles are left alone: the browser checks them every time, so a change shows at once.
// No imports, so Node can test it.
const YEAR = "public, max-age=31536000, immutable";
const DAY = "public, max-age=86400";

export function cacheFor(pathname) {
  if (/^\/fonts\/.+\.woff2$/.test(pathname)) return YEAR;
  if (/\.(png|jpe?g|mp4|vtt)$/.test(pathname)) return DAY;
  return null;
}

// Gives a file answer its keep-time. Only good answers (whole, part, or "unchanged") are touched.
export function withCache(res, pathname) {
  const keep = [200, 206, 304].includes(res.status) && cacheFor(pathname);
  if (!keep) return res;
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", keep);
  return out;
}
