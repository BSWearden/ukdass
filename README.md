# DASS Alpha 0.2 — Operator Authentication

This package adds the first Range Operator authentication layer to the existing `ukdass` Next.js project.

## Replace / add these files

Copy the contents of this package into the root of your local `ukdass` repository, preserving the folder structure.

It will:
- replace `package.json`
- add `proxy.ts`
- add `lib/supabase/client.ts`
- add `lib/supabase/server.ts`
- add `lib/supabase/proxy.ts`
- add `app/operator/login/page.tsx`
- add `app/operator/page.tsx`
- add `app/operator/actions.ts`

Do not delete your existing `app/page.tsx`, `app/globals.css`, `app/layout.tsx`, or public assets.

## Vercel environment variables

Add the two variables listed in `ENVIRONMENT-VARIABLES.txt` to:
Vercel > ukdass project > Settings > Environment Variables

Apply them to Production, Preview, and Development.

## Supabase setting

In Supabase Dashboard:
Authentication > Providers > Email

Disable public/new-user sign-ups if the dashboard exposes an "Allow new users to sign up" / signup enable toggle.

The DASS application itself contains no sign-up UI.

## Operator account provisioning

For Alpha testing, create/invite an operator from:
Supabase Dashboard > Authentication > Users

After a user exists, the DASS database also needs an `operator_profiles` row and a DA permission assignment. We will do that together after the login page is deployed.

## GitHub / Vercel

Commit:
`Add Alpha 0.2 operator authentication`

Push origin. Vercel should redeploy automatically.

Then test:
https://ukdass.org/operator
