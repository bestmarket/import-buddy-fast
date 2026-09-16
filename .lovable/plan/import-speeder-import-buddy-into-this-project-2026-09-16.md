# Import speeder-import-buddy into this project

The repo is public and is already a Lovable app of the same kind as this one (same framework and styling), so this is a straight copy-in rather than a rebuild.

## What the app does

A video-content workspace behind a login:

- Sign in / sign up page
- Sources: notes and source videos you add per channel
- Chat: AI assistant for ideas and scripts
- Studio: script, video editor, production dialog, captions
- Channels: connected channels, posts, and scheduled publishing
- A scheduled job that publishes due videos every 15 minutes

## Steps

1. Copy all app code, pages, components, and styling from the repo into this project, replacing the placeholder home page.
2. Install the extra packages the app needs (AI, animation, markdown, video and chart libraries).
3. Turn on Lovable Cloud for this project, then create the database exactly as in the repo: profiles, channels/projects, sources, source videos, ideas, scripts, videos, posts, and the scheduler settings table — each with its own access rules so people only ever see their own rows. Also create the private media storage bucket with matching rules.
4. Add the automatic profile creation on sign-up and the timestamp triggers.
5. Point the app at this project's own Cloud backend (the repo's keys belong to the original project and will not be reused).
6. Re-check the scheduled publishing endpoint so it targets this project's address.
7. Give each page its own title and description for search and sharing.
8. Verify: the site builds, sign-up works, a profile is created, and a note saves and reloads.

## Data and accounts

Existing content and user accounts from the original app do not come across with the code. If you have an export (CSV or JSON) I can load it afterwards; otherwise the new copy starts empty and people sign up fresh.

## Things to confirm after the build

- AI features run on the built-in Lovable AI credit, no key needed.
- If the app connects to YouTube or another channel for real publishing, that connection needs its own credentials — I will tell you exactly which ones once the code is in.
- Scheduled publishing only runs against a published site.

## Technical notes

- Stack matches this project: TanStack Start v1, React 19, Tailwind v4, server functions, Supabase-backed Lovable Cloud.
- Auth-gated routes live under `_authenticated`; the public cron endpoint stays under `src/routes/api/public/`.
- TanStack package versions stay at this project's pinned versions.
- The repo's `.env` values are ignored; this project's own Cloud env vars are used.
