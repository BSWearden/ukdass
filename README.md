# UK DASS Alpha 0.1

UK Dynamic Airspace Status System — demonstration prototype.

## Safety status
This repository contains demonstration software only. It is **not for operational use or flight planning** and does not supersede the UK AIP, NOTAM, ATC instructions, or established Danger Area crossing procedures.

## Run locally
```bash
npm install
npm run dev
```
Then open http://localhost:3000

## Upload to GitHub
1. Open the `BSWearden/ukdass` repository.
2. Choose **Add file → Upload files**.
3. Upload the contents of this project folder (not the enclosing folder itself).
4. Commit directly to `main` with the message `Add DASS Alpha 0.1`.

## Import to Vercel
1. Sign in to Vercel.
2. Choose **Add New → Project**.
3. Import `BSWearden/ukdass` from GitHub.
4. Vercel should detect **Next.js** automatically.
5. Leave the root directory as `./` and use the default build settings.
6. Click **Deploy**.

Once deployed, Vercel will provide a `.vercel.app` URL. After verification, connect `ukdass.org` in **Project Settings → Domains**.

## Next development steps
- Supabase database integration
- Range operator authentication
- Area-specific permissions
- Live activate/deactivate controls
- Audit history
- Status expiry / unverified state
