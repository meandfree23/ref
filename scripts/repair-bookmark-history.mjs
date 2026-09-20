import { readBookmarkHistoryIndex, writeBookmarkHistoryIndex } from "./bookmark-history-core.mjs";

const before = readBookmarkHistoryIndex();
const after = writeBookmarkHistoryIndex(before);

console.log(JSON.stringify({
  ok: true,
  before: before.items.length,
  after: after.itemCount,
  removed: before.items.length - after.itemCount,
}, null, 2));
