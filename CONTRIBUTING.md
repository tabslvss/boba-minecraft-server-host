# Contributing to Boba 🧋

Thanks for helping make Boba better!

## Run it locally

```bash
npm install
npm start
```

No build step: edit a file, then press **Ctrl+R** in the app window to reload the UI (restart the app after changing `main.js` or `backend/`).

## Where things live

- `backend/`: everything that touches files, processes and the internet (Node.js)
- `renderer/js/views/`: one file per page in the app
- `renderer/js/ui.js`: shared helpers (toasts, popups, tooltips, setting rows)
- `renderer/styles.css`: all styles, with colors as variables at the top

## Code style

- Keep it **simple and beginner readable**: clear names, small functions, comments that explain *why*.
- No long one-liners.
- Every new setting needs a short tooltip (`tip`) and an example (`ex`).

## Pull requests

1. Fork and create a branch (`feature/…` or `fix/…`).
2. Test your change with a real server if it touches the backend.
3. Add a screenshot for UI changes.
4. Describe what changed and why.

## Reporting bugs

Use the **Bug report** template and include the console or tunnel log if possible.
