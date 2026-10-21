/**
 * HTTP helpers over UrlFetchApp.
 *
 * Differences from Node's fetch that matter here:
 *  - `muteHttpExceptions: true` is essential, otherwise a 404 throws instead of
 *    returning a response we can report on;
 *  - there is no AbortController; UrlFetchApp has its own internal timeout and
 *    the 6-minute total script limit is the real ceiling;
 *  - cookies are NOT handled automatically, so the Senate handshake has to read
 *    Set-Cookie and echo it back by hand.
 */

function httpFetch_(url, options) {
  options = options || {};
  var headers = options.headers || {};
  headers['User-Agent'] = userAgent_();

  var params = {
    method: options.method || 'get',
    headers: headers,
    muteHttpExceptions: true,
    followRedirects: options.followRedirects !== false,
    validateHttpsCertificates: true
  };
  if (options.payload) params.payload = options.payload;
  if (options.contentType) params.contentType = options.contentType;

  var retries = options.retries === undefined ? 2 : options.retries;
  var lastErr = null;

  for (var attempt = 0; attempt <= retries; attempt++) {
    try {
      var res = UrlFetchApp.fetch(url, params);
      var code = res.getResponseCode();
      // Retry transient upstream conditions only; a 404 is an answer, not a fault.
      if ((code >= 500 || code === 429) && attempt < retries) {
        Utilities.sleep(400 * Math.pow(2, attempt));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        Utilities.sleep(400 * Math.pow(2, attempt));
        continue;
      }
    }
  }
  throw new Error('request to ' + hostOf_(url) + ' failed: ' + (lastErr && lastErr.message));
}

function httpJson_(url, options) {
  options = options || {};
  options.headers = options.headers || {};
  options.headers['Accept'] = 'application/json';
  var res = httpFetch_(url, options);
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(hostOf_(url) + ' returned HTTP ' + code);
  }
  return JSON.parse(res.getContentText());
}

function httpText_(url, options) {
  var res = httpFetch_(url, options);
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(hostOf_(url) + ' returned HTTP ' + code);
  }
  return res.getContentText();
}

function hostOf_(url) {
  var m = String(url).match(/^https?:\/\/([^\/]+)/i);
  return m ? m[1] : String(url);
}

/**
 * Collect Set-Cookie values into a jar. UrlFetchApp returns the header as a
 * string when there is one cookie and an array when there are several, so both
 * shapes have to be handled.
 */
function CookieJar_() {
  this.jar = {};
}

CookieJar_.prototype.absorb = function (response) {
  var headers = response.getAllHeaders();
  var raw = headers['Set-Cookie'] || headers['set-cookie'];
  if (!raw) return;
  var list = (typeof raw === 'string') ? [raw] : raw;
  for (var i = 0; i < list.length; i++) {
    var pair = String(list[i]).split(';')[0];
    var eq = pair.indexOf('=');
    if (eq < 1) continue;
    this.jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
};

CookieJar_.prototype.get = function (name) {
  return this.jar[name] || null;
};

CookieJar_.prototype.header = function () {
  var parts = [];
  for (var k in this.jar) if (this.jar.hasOwnProperty(k)) parts.push(k + '=' + this.jar[k]);
  return parts.join('; ');
};

/** Form-encode an object for a POST body. */
function formEncode_(obj) {
  var parts = [];
  for (var k in obj) {
    if (!obj.hasOwnProperty(k)) continue;
    var v = obj[k];
    if (Object.prototype.toString.call(v) === '[object Array]') {
      for (var i = 0; i < v.length; i++) {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v[i]));
      }
    } else {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
  }
  return parts.join('&');
}
