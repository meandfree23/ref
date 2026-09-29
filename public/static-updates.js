// Legacy shim. Pages cached before the v2 redesign (2026-09-25) still request this file
// and would otherwise render a frozen snapshot plus only today's items, which shows up
// as "missing dates". Send those stale pages to the current site instead.
(function () {
  try {
    var view = new URLSearchParams(window.location.search).get("view");
    window.location.replace("/?fresh=" + Date.now() + (view ? "&view=" + encodeURIComponent(view) : ""));
  } catch (error) {
    window.location.replace("/");
  }
})();
