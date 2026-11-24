# Local checks

- Run `npm test` and `npm run dev` from PowerShell in a working folder whose path starts with an upper-case `C:\`. A lower-case `c:\dev` path breaks vitest and the dev server.
- Before starting a dev server, check whether one is already serving this folder (Robin's, perhaps), and use it. A server you start may not use port 5173: use the port it prints. Stop any server you start, including its `node` process, when you are done.
- Browser checks: drive headless Chrome over the DevTools Protocol, with a fresh `--user-data-dir` for each run, so that it is a new visitor. Click with real mouse events (`Input.dispatchMouseEvent`), not `element.click()`, which ignores CSS `pointer-events` and so misses whether a control can really be clicked.
- Check key and click handling in the browser, not only in tests. jsdom runs event listeners without the microtask checkpoint a real browser runs between them, so a test can pass where the browser fails.
- Wait about 3 seconds after a page loads before pressing a button: before hydration a button may do nothing, or a link may navigate without its state. If Vite re-optimises its dependencies during a run, the page reloads; run the check again.
- PowerShell cannot pass multi-line text to `gh` as an argument, and its `Set-Content` and `Out-File` add a byte-order mark. Write the text to a file and pass it with `--body-file`.
