# Checks for the Apps Script port

Apps Script can't run outside Google, so these exercise the project the two ways
that are possible off-platform.

```bash
node test/verify.js          # 42 logic + parser checks
```

Loads every `.gs` file into one shared scope — exactly how the platform treats
them — with shims for the services they touch (`test/shims.js`). Catches syntax
errors, logic regressions, and the failure mode unique to Apps Script: a name
collision between two files sharing one global namespace.

```bash
node test/make-fixture.js    # build a snapshot fixture from the real aggregation
node test/build-preview.js   # resolve Index.html's scriptlets into a standalone page
# then open test/preview.html in a browser
```

`build-preview.js` mimics HtmlService's templating (`<?!= include('X') ?>` and
`<?= var ?>`) and stubs `google.script.run` with the fixture, so the ~950-line
client can be rendered and clicked through in an ordinary browser. That is how
the mobile layout and the price chart were verified; both generated files are
gitignored.

These validate **parsing, logic and rendering — not live endpoint behaviour.**
Upstream markup and field names can still drift.
