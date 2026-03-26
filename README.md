# Badminton Tournament Tracker

This folder contains a deployable single-page tournament tracker built from your team and fixture sheets.

## What it does
- Shows league and final fixtures
- Lets you enter set-by-set scores
- Automatically computes:
  - match winner
  - standings
  - tournament points (Win = 2, Loss = 0)
  - point difference
- Shows current group leaders and finalists
- Works on phones and laptops

## Files
- `index.html` — the app
- `supabase-schema.sql` — optional SQL schema for live sync across devices
- `tournament-data.json` — data extracted from your Excel sheets

## Fastest way to use it

### Option 1: Local only
Open `index.html` in a browser.
- Scores are stored in that browser using local storage.
- Good for one operator laptop connected to a TV/projector.

### Option 2: Live sync for everyone
Use Supabase and Vercel or Netlify.

#### Supabase
1. Create a new Supabase project.
2. Open SQL Editor.
3. Run the SQL in `supabase-schema.sql`.
4. In `index.html`, update:
   - `useSupabase: true`
   - `supabaseUrl`
   - `supabaseAnonKey`

#### Hosting
- Vercel: create a new project and upload this folder, or push to GitHub and import it.
- Netlify: drag and drop the folder or zip into Netlify Drop.

## Admin mode
- Default PIN in the file is `2026`
- Change `adminPin` near the top of `index.html`

## Notes
- The PIN is light protection only.
- For a one-day office tournament, this is usually good enough.
- Final slots automatically map `A1` and `B1` to the current top team in Group A and Group B.