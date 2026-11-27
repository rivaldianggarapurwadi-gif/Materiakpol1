# Kentung stickers

The site's mascot. 27 stickers cut from the owner's sticker sheet, each with a transparent background and its white sticker border.

Every pose comes in two files:

- `<pose>.webp`: full size (about 400–480 px wide), for the hero, dialogs and state cards.
- `<pose>-s.webp`: half size (about 12 KB), for mapel cards, list rows and toasts.

In `index.html` a sticker is placed with `kentung('<pose>', widthPx)`, which picks the right file. The poses and their pixel sizes are listed in the `K` constant; `MAPEL_POSE` maps subject names to poses.

| Pose | Used for |
|---|---|
| `hello` | Home hero on wide screens (full body) |
| `salute` | Morning greeting, login dialog, "admin only" page, Sabhara |
| `thumbs` | Success message, upload finished, Polair |
| `eat`, `fight`, `study`, `yawn` | Greetings by time of day; `yawn` also marks an empty folder, `study` the Office preview card |
| `run` | Loading, a course in progress, "still processing" |
| `think` | Search results and "not found", Reserse |
| `cry` | Errors |
| `please` | Delete confirmation, YouTube blocked, no preview available |
| `point` | Info message, Lantas |
| `laptop` | TIK, footer, upload page |
| `pushup` | While files are uploading |
| `cool` | Course completed, Intel |
| `game`, `guitar` | Kursus page header, "no courses yet" |
| `heart`, `smug`, `laugh` | Binmas, Manajemen Bin Polri, IELTS |
| `drink`, `relax`, `tired` | Kentung's lines on the home page, playback problems |
| `love`, `pray` | Subjects without a pose of their own |
| `angry`, `sleep` | Not used yet |
