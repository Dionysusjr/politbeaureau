/**
 * Minimal stand-ins for the Apps Script services the pure logic touches, so the
 * .gs files can be exercised under Node. These are TEST-ONLY: they cover just
 * enough of each API surface for the checks in verify.js, and nothing more.
 */

/** XmlService over a small hand-rolled parser — enough for the House index. */
function makeElement(tag, inner) {
  return {
    _tag: tag,
    _inner: inner,
    getName: function () { return tag; },
    getText: function () {
      return String(inner).replace(/<[^>]*>/g, '').trim();
    },
    getChildren: function (name) {
      var out = [];
      var re = new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'g');
      var m;
      while ((m = re.exec(inner)) !== null) out.push(makeElement(name, m[1]));
      return out;
    },
    getChild: function (name) {
      var self = new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)<\\/' + name + '>');
      var m = inner.match(self);
      if (m) return makeElement(name, m[1]);
      // Self-closing tags carry no text.
      if (new RegExp('<' + name + '\\b[^>]*\\/>').test(inner)) return makeElement(name, '');
      return null;
    }
  };
}

const XmlService = {
  parse: function (xml) {
    const body = String(xml).replace(/<\?xml[^>]*\?>/g, '');
    const m = body.match(/<([A-Za-z_][\w.-]*)\b[^>]*>([\s\S]*)<\/\1>/);
    if (!m) throw new Error('XmlService shim: no root element');
    const root = makeElement(m[1], m[2]);
    return { getRootElement: function () { return root; } };
  }
};

const Utilities = {
  sleep: function () {},
  formatDate: function (date, tz, fmt) {
    // Only the patterns Refresh.gs uses.
    const d = new Date(date);
    if (fmt === 'u') { const wd = d.getUTCDay(); return String(wd === 0 ? 7 : wd); }
    if (fmt === 'H') return String(d.getUTCHours());
    if (fmt === 'm') return String(d.getUTCMinutes());
    throw new Error('Utilities.formatDate shim: unsupported format ' + fmt);
  },
  unzip: function (blob) {
    // Fed a fake blob carrying pre-named entries.
    return blob.__entries;
  }
};

function fakeZipBlob(entries, totalBytes) {
  return {
    __entries: entries.map(function (e) {
      return {
        getName: function () { return e.name; },
        getDataAsString: function () { return e.data; }
      };
    }),
    getBytes: function () { return { length: totalBytes }; }
  };
}

const _cache = {};
const CacheService = {
  getScriptCache: function () {
    return {
      get: function (k) { return _cache[k] === undefined ? null : _cache[k]; },
      getAll: function (keys) {
        const out = {};
        keys.forEach(function (k) { if (_cache[k] !== undefined) out[k] = _cache[k]; });
        return out;
      },
      put: function (k, v) {
        if (String(v).length > 100 * 1024) throw new Error('Argument too large: value');
        _cache[k] = v;
      },
      putAll: function (obj) {
        for (const k in obj) if (obj.hasOwnProperty(k)) this.put(k, obj[k]);
      }
    };
  }
};

const _props = {};
const PropertiesService = {
  getScriptProperties: function () {
    return {
      getProperty: function (k) { return _props[k] === undefined ? null : _props[k]; },
      getProperties: function () { return Object.assign({}, _props); },
      setProperties: function (obj) { Object.assign(_props, obj); }
    };
  }
};

const UrlFetchApp = {
  fetch: function () { throw new Error('UrlFetchApp shim: network is not exercised in these checks'); }
};

const Logger = { log: function () {} };
const ScriptApp = { getProjectTriggers: function () { return []; } };

module.exports = { XmlService, Utilities, CacheService, PropertiesService, UrlFetchApp, Logger, ScriptApp, fakeZipBlob, _props, _cache };
