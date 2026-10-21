/**
 * Snapshot storage.
 *
 * CacheService caps a single value at 100KB, and a full snapshot (filers,
 * assets, trades) is comfortably larger — so values are split across numbered
 * chunk keys with a small index key describing the set. Reads rebuild the
 * string from the chunks and fail soft if any are missing (cache entries can
 * expire or be evicted independently).
 *
 * Cache is the right tier for this: it's fast, shared across executions, and
 * the data is derived — losing it costs one refresh, not real information.
 * A copy also goes to Script Properties, which survives cache eviction, so a
 * cold start after a quiet night serves the last good snapshot instead of an
 * empty page while the next refresh runs.
 */

var SNAPSHOT_KEY_ = 'snapshot';
var CHUNK_BYTES_ = 90 * 1024;            // headroom under the 100KB cache limit
var SNAPSHOT_TTL_SECONDS_ = 6 * 60 * 60; // CacheService maximum
var PROP_CHUNK_BYTES_ = 8 * 1024;        // Properties cap ~9KB per value

function chunkString_(text, size) {
  var chunks = [];
  for (var i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

/** Write the snapshot to cache (fast path) and properties (durable path). */
function storeSnapshot_(snapshot) {
  var json = JSON.stringify(snapshot);
  var cache = CacheService.getScriptCache();

  var chunks = chunkString_(json, CHUNK_BYTES_);
  var payload = {};
  for (var i = 0; i < chunks.length; i++) payload[SNAPSHOT_KEY_ + ':' + i] = chunks[i];
  payload[SNAPSHOT_KEY_ + ':index'] = String(chunks.length);

  cache.putAll(payload, SNAPSHOT_TTL_SECONDS_);

  // Durable copy. Properties are slower and smaller, so this is best-effort:
  // a snapshot too big to persist still lives in cache.
  try {
    var pchunks = chunkString_(json, PROP_CHUNK_BYTES_);
    if (pchunks.length <= 40) {
      var p = {};
      for (var j = 0; j < pchunks.length; j++) p['snap_' + j] = pchunks[j];
      p['snap_count'] = String(pchunks.length);
      props_().setProperties(p, false);
    }
  } catch (err) {
    // Non-fatal: the cache copy is the one that serves requests.
  }

  return { bytes: json.length, cacheChunks: chunks.length };
}

function readSnapshotFromCache_() {
  var cache = CacheService.getScriptCache();
  var count = Number(cache.get(SNAPSHOT_KEY_ + ':index'));
  if (!count || !isFinite(count)) return null;

  var keys = [];
  for (var i = 0; i < count; i++) keys.push(SNAPSHOT_KEY_ + ':' + i);
  var found = cache.getAll(keys);

  var parts = [];
  for (var j = 0; j < count; j++) {
    var part = found[SNAPSHOT_KEY_ + ':' + j];
    if (part === null || part === undefined) return null;  // incomplete set
    parts.push(part);
  }

  try {
    return JSON.parse(parts.join(''));
  } catch (err) {
    return null;
  }
}

function readSnapshotFromProps_() {
  var all = props_().getProperties();
  var count = Number(all['snap_count']);
  if (!count || !isFinite(count)) return null;

  var parts = [];
  for (var i = 0; i < count; i++) {
    var part = all['snap_' + i];
    if (part === undefined) return null;
    parts.push(part);
  }
  try {
    return JSON.parse(parts.join(''));
  } catch (err) {
    return null;
  }
}

/** Cache first, durable copy second, null when nothing has ever been stored. */
function readSnapshot_() {
  return readSnapshotFromCache_() || readSnapshotFromProps_();
}
