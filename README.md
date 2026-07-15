# Schedule Ledger

A single-admin schedule planner (CRUD) for a middle school, built for grades 6–9.

## Features

- Weekly view, Monday–Saturday, with one class per grade
- Fixed daily structure:
  - Period 1 — 7:30 – 9:30
  - Break — 9:30 – 9:45
  - Period 2 — 9:45 – 11:45
  - Lunch — 11:45 – 2:00
  - Period 3 — 2:00 – 4:00
- Click any class slot to create, edit, or remove an activity
- Assign one or more teachers to each class
- Data is saved automatically to your browser's local storage

## Getting started

```bash
npm install
npm run dev
```

Then open the local URL Vite prints (usually `http://localhost:5173`).

## Build for production

```bash
npm run build
npm run preview
```

## Tech stack

- React 18 + Vite
- [lucide-react](https://lucide.dev/) for icons
- No backend — data persists in the browser via `localStorage`

## Notes

This is a single-user admin tool. There's no login/auth layer, since it's meant
to be run locally or deployed privately for one administrator. If you want to
share it across a team later, the next step would be swapping `localStorage`
for a small backend (e.g. a lightweight API + database) so everyone sees the
same schedule.
