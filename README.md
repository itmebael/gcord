# Run locally

Use Node.js 22 or newer and run `npm start` from this directory. Open
http://localhost:8001/scan.html and sign in there.

In Windows PowerShell, use `npm.cmd start` (or `node local-server.js`) if script
execution policy blocks `npm`.

The server loads `ROBOFLOW_API_KEY` and `ROBOFLOW_WORKFLOW_URL` from `.env.local`.
Keep this file private. Receipt images go through `/api/roboflow-workflow` on the
backend; the API key is never sent to the browser.

A static server such as `python -m http.server` cannot run the scan API and
returns HTTP 501 for scan requests. Use `npm start` to enable cloud scanning.

For Vercel, configure those environment variables in the project settings.
Vercel runs the existing `api/roboflow-workflow.js` function directly.
