# Hisaab — household finance tracker for Aum & Saumya

A browser app (works on phone and laptop) backed by Supabase, hosted on Vercel. Both of you sign in with your own Google account and see the same live data.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app itself (no build step) |
| `config.js` | Your Supabase URL + anon key go here |
| `schema.sql` | Database tables, security rules and starter categories |
| `manifest.json`, `icon-*.png`, `apple-touch-icon.png` | Lets you install it on your phone's home screen |

## Setup (about 15 minutes)

**1. Create a new Supabase project.** Name it `hisaab`, region Mumbai (ap-south-1). Use a fresh project rather than the Arhatic log one, since table names like `members` and `settings` could clash. (Free plan allows two active projects; if you're at the limit, pause one or upgrade.)

**2. Run the database script.** Open `schema.sql`, replace `aum@example.com` and `saumya@example.com` in section 7 with the Google emails you'll each sign in with. Then Supabase → SQL Editor → New query → paste → Run.

**3. Turn on Google sign-in.** Supabase → Authentication → Sign In / Providers → Google → enable, paste the same Client ID and Secret you used before. In Google Cloud Console → Credentials → your OAuth client, add this project's callback URL (shown on the Supabase Google provider page, looks like `https://xxxx.supabase.co/auth/v1/callback`) under Authorised redirect URIs. Email magic links work out of the box as a backup.

**4. Add your keys.** Supabase → Project Settings → API. Copy the Project URL and the anon/publishable key into `config.js`.

**5. Deploy.** Create a new GitHub repo, upload all these files to its root, then in Vercel: Add New → Project → import the repo → Framework preset "Other", no build command → Deploy.

**6. Tell Supabase your site address.** Supabase → Authentication → URL Configuration: set Site URL to your Vercel URL (e.g. `https://hisaab-xyz.vercel.app`) and add the same URL under Redirect URLs.

**7. Install on your phones.** Open the Vercel URL. iPhone: Safari → Share → Add to Home Screen. Android: Chrome → ⋮ → Install app.

Optional: once you've both signed in once, you can switch off "Allow new users to sign up" in Supabase → Authentication → Settings. Strangers can't see anything either way (only the two emails in `members` can read or write data), but this keeps the user list clean.

## How it works

**Adding an entry** — tap the red +. Type the amount (you can type `450+120` and it adds up), tap a category, save. Categories you use most float to the top. Paid-by defaults to whoever is signed in, and if a category was last logged as Shared (like groceries) it stays Shared automatically.

**Whose expense is it?** — *For Aum*, *For Saumya*, or *Shared* with a slider for the split. This drives the individual dashboards (each person sees their own share) and Settle up (who owes whom).

**Dashboard** — switch between Household / Aum / Saumya and Day / Week / Month / Year. Shows balance, income, spending, savings rate, comparison with the same point last period, tithing vs 10% of income, bills due, spending by category (tap one to see its entries), spending over time, budgets, who owes whom and goals.

**Plan** — Budgets (monthly limit per category, with your 3-month average as a guide), Recurring (rent, SIPs, subscriptions, salary: shows on Home each month with a one-tap Pay button, and can't be logged twice), Goals (target + date, tells you how much to set aside monthly).

**Settle** — running balance between the two of you. Record a payback and it resets.

**Settings** (top-right) — tithing %, rename/add/hide categories and emojis, download everything as CSV, sign out.

## Changing things later

- Currency is Indian rupees throughout (`en-IN` formatting with lakhs/crores).
- Payment methods are the `PAY_METHODS` list at the top of `app.js`.
- Colours for Aum and Saumya are in the `members` table (`color` column).
