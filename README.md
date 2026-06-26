# APDF Preserve Preview Page After Apply

Changed files:

```text
app/static/js/edit/app.js
app/static/js/edit/pdf-preview.js
```

Behavior:

- When an edit operation is applied, the preview reloads the edited PDF on the page number that was visible before applying the edit.
- If the operation reduces the page count and the previous page no longer exists, the preview is clamped to the last available page.
- Undo also restores the page number stored with the undo snapshot.

No backend files were changed.
