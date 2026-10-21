/**
 * Resolve Index.html's Apps Script scriptlets into a standalone page so the
 * client can be rendered in a normal browser.
 *
 * This mimics HtmlService's templating exactly where it matters:
 *   <?!= include('X') ?>  -> the contents of X.html   (force-printed, unescaped)
 *   <?= name ?>           -> the template variable's value
 * and stubs google.script.run with the fixture, since the real bridge only
 * exists inside the Apps Script sandbox.
 *
 * TEST ONLY — the output is not part of the deployed project.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf8'));

const vars = { initialView: 'dashboard', initialId: '', pollMs: 30000 };

let html = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
html = html.replace(/<\?!=\s*include\('([^']+)'\);?\s*\?>/g, (_m, name) =>
  fs.readFileSync(path.join(ROOT, name + '.html'), 'utf8'));
html = html.replace(/<\?=\s*(\w+)\s*\?>/g, (_m, name) => {
  if (!(name in vars)) throw new Error('template variable not supplied: ' + name);
  return String(vars[name]);
});
if (/<\?/.test(html)) throw new Error('unresolved scriptlet remains in Index.html');

// Stand in for the Apps Script RPC bridge.
const stub = `
<script>
window.__fixture = ${JSON.stringify(fixture)};
var google = { script: { run: (function () {
  var handlers = {};
  var api = {
    withSuccessHandler: function (fn) { handlers.success = fn; return api; },
    withFailureHandler: function (fn) { handlers.failure = fn; return api; },
    getSnapshotForClient: function () {
      setTimeout(function () { handlers.success(window.__fixture.snapshot); }, 10);
    },
    refreshNowForClient: function () {
      setTimeout(function () { handlers.success(window.__fixture.snapshot); }, 10);
    },
    getPoliticianForClient: function (id) {
      setTimeout(function () {
        handlers.success(id === window.__fixture.politicianDetail.id
          ? window.__fixture.politicianDetail : null);
      }, 10);
    },
    getAssetForClient: function (id) {
      setTimeout(function () {
        var d = window.__fixture.assetDetail;
        handlers.success((id === d.id || id === d.ticker) ? d : null);
      }, 10);
    }
  };
  return api;
})() } };
</script>`;

html = html.replace('</head>', stub + '\n</head>');
const out = path.join(__dirname, 'preview.html');
fs.writeFileSync(out, html);
console.log('wrote', out, '(' + Math.round(html.length / 1024) + ' KB)');
