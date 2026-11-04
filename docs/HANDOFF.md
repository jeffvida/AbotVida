# AbotVida: project handoff (as of Nov 4, 2026, night)

## Business
- **AbotVida**: installment (hulugan) online shop in the Philippines. Formerly Mara Online Shop, then MPVida.
- Tagline: "Mas abot, mas saya." Descriptor: Gadgets • Appliances • Furniture — Hulugan Available.
- Positioned as a **store that offers installment terms**, not a lender.
- Model:
  - The customer pays a one-time **service charge** upfront. It is the owner's revenue, set per product as a fixed ₱ amount or a %, and is not deducted from the item price.
  - The **item price** is then paid monthly. The monthly amount is **rounded up to the next whole peso**, and the last month is a little smaller so the total equals the item price exactly. Example: ₱15,999 over 12 months is ₱1,334 × 11, then ₱1,325.
  - Total = service charge + item price.
- The owner buys the item with a personal credit card after approving the request.
- Policies:
  - Items are brand new with store warranty.
  - Valid ID and ATM card are required once approved (not needed to request a quote).
  - Payment by GCash, mobile banking or cash.
  - Late payment penalty applies. **The exact amount is still to be decided** (set it in Settings).
  - Free delivery or meet-up for small items; the delivery charge is included in the price for large items.
  - Groceries are mostly paid in 1 month.

## Brand
- Logo: the owner's SVG (navy and orange AV ribbon monogram with a credit card detail). It is built into the site (header, footer, favicon, phone icon, share image).
  - Logo colors: navy #103568, orange #FF7900 with gradient #FFB21A → #F4510B.
  - Site colors: ink navy #14234B, orange #F7801E.
- Palette v2 (applied):
  - Light mode: page #EEF2F7, white cards, logo navy for brand moments (category icons, links, one deep-navy banner), orange only for buttons and prices (#B3550A for price text).
  - Dark mode: three navy layers (#0A1230 / #15204A / #1D2B5C), no brown.
- Font: Montserrat. Wordmark "Abot" navy + "Vida" orange.

## Where things live
- **Live site:** https://abotvida.jeffhersonvida.workers.dev
  - Owner dashboard: add `/#owner` to the address.
  - The Owner button shows only on devices where the owner has signed in. On a new device, tap "© 2026 AbotVida · Philippines" in the footer 5 times to open sign-in.
- **Code:** GitHub `jeffvida/AbotVida`, branch `main`.
  - `site/`: index.html, logo SVGs, favicon, apple-touch-icon, og-cover.png
  - `apps-script/`: Code.gs and SETUP.md
  - `templates/`: product import Excel template
  - `wrangler.jsonc`
- **Chat assistant server:** `worker/index.js` (Cloudflare Worker, runs only for `/api/*`; everything else is served from `site/`). Needs the Cloudflare secret `GEMINI_API_KEY`. Optional variables: `GEMINI_MODEL`, `CHAT_DAILY_LIMIT`. If a Gemini model is busy (503), over its free limit (429) or unavailable, the next one is tried: gemini-flash-latest → gemini-2.5-flash → gemini-flash-lite-latest → gemini-2.5-flash-lite. Error replies include a short `why` for troubleshooting. Branch `preview/diag` runs a live check of the chat from GitHub when pushed.
- **Deploys:** GitHub Actions (`.github/workflows/deploy.yml`) publishes `site/` to Cloudflare Workers on every push to `main`. It uses the repository secret `CLOUDFLARE_API_TOKEN` and Cloudflare account ID 14f2c4e88d58b483414ab156bbbacfcd.
  - Cloudflare's own Git build kept timing out, so the owner was asked to disconnect it.
  - workers.dev Production is on and Preview URLs are off. Zero Trust/Access is not used.
- **Previews:** work happens on a branch and is shown on the Claude preview page (sample data, no login) before going live. The owner approves with "push it live".
- **Database:** Google Sheet "AbotVida Database" with an Apps Script web app.
  - Web app URL (set as `API_URL` in index.html): https://script.google.com/macros/s/AKfycbwn66tGLtX6le9O7Zrhe3dhK8J6JinUoP-u6D95q_6EeoDVVVfxnf4WNQdver3BWBPUDQ/exec
  - Sheet tabs: Products, Requests, Accounts, Reviews, Notes, Cards, Banners, Photos, Settings, Reminder log. The last column of each tab holds the record data; don't edit it by hand.
  - Photos are stored in the Drive folder "AbotVida images".
  - Sheet menu: AbotVida → Set up sheets / Set owner password / Sign out all devices / Set up email reminders / Send email reminders now.
- **Project files:** abotvida-site/index.html, abotvida-site/apps-script/Code.gs and SETUP.md, abotvida-site/abotvida-logo.svg.
- The old Cloudflare project "sparkling-fire-ae80" can be deleted.

## Website: customer side
- Header: logo, search, dark/light toggle, Messenger (icon only on phones). No visible Owner button for visitors.
- Home page, in order:
  - banners (editable; one deep-navy)
  - trust strip: brand new with warranty · GCash, bank or cash · free delivery on small items · flexible terms
  - category icons
  - compact "1 · 2 · 3" how-it-works strip
  - Hot picks, shown only when there are more products than fit on one page
  - All products, with monthly budget filters and sort
  - Request any item
  - reviews and customer photos (only when real ones exist)
  - FAQ
  - footer
- Product cards show the monthly amount, term, total and "**₱X service charge**".
- Product page:
  - photo gallery, price box (item price and service charge), payment terms
  - **Good to know** (editable), penalty notice, details, More like this
  - sticky Chat / Request installment bar, with a bottom-sheet term picker leading to the form
- Request forms (catalog item, and Request any item):
  - name, mobile, **email (optional, for payment reminders)**, Messenger, message
  - two required ticks: the late payment penalty, and **Data Privacy consent** with an expandable privacy notice
  - The Google Sheet also checks the privacy consent and records when the customer agreed.
- Done screen: reference number (MQ-…), copy-ready details, Continue on Messenger.
- Footer: Facebook Page, location, hours and DTI number (each hidden until filled in Settings), Check my balance, Write a review, Privacy notice.
- **AbotVida Assistant chat bubble** (right side; above the bottom menu / Request bar on phones): welcome note after 3 s, once per visit; opens only when tapped; quick questions; product names link to the product; Messenger hand-off. Replies in the customer's language via Gemini. Monthly amounts are calculated in the Worker, not by the AI. Rules: always "service charge", no approval promises, no pressure, never asks for IDs/cards/addresses, shop topics only. Limits: 20 messages per visitor per hour and 600 per day (in memory, best effort) plus Gemini's own free-tier limits. Knows which product the customer is viewing (quick buttons change on product pages); budget finder from a code-built BUDGET GUIDE; reply tags [[req:ID:MONTHS]] and [[any:NAME]] become buttons that open the request form pre-filled (in-stock items and offered terms only). If all models are busy it waits 1.5 s and tries once more. Hidden until the Gemini key is set, on the owner dashboard, and while a form is open. Privacy notice mentions Gemini.
- **Check my balance** (footer link, or the `#balance` address): the customer enters only their mobile number and sees every account on it with payments left (balance, next payment, schedule) plus requests still being reviewed. First name only; no contact details, notes or card. Limited to 20 lookups per number and 600 in total per hour. The owner accepted the trade-off that anyone who knows a number can see that customer's balance; a second check (e.g. first name) can be added later.
- Excel reader loads only when the owner imports a file, so the shop stays fast on mobile data.

## Website: owner side
- Sign-in with a password set in the Sheet:
  - The password is stored hashed. A sign-in lasts 30 days per device. 8 wrong tries lock sign-in for 15 minutes.
- Saving:
  - Every change saves to Google Sheets automatically; a status bar shows "All changes saved".
  - Customer requests that arrive while the owner is editing are kept.
  - The dashboard refreshes every 30 seconds and when switching tabs.
- Full-width layout. On phones, Products, Quote Requests, Accounts and Payments show as cards.
- **Overview:** tiles, payments needing attention, new requests, a **This month** panel (customer payments due vs collected, all payments received, service charges received / not yet received, new purchases, card bills with due dates; ‹ › to change month), a "Still to fill in" checklist, and credit cards used.
- **Products:**
  - add, edit and remove; Excel/CSV import (template `AbotVida-products-template.xlsx`; Product Name and Item Price are required)
  - ★ Hot picks; tap a row to edit; delivery size per product
  - **search box and category chips** (plus ★ Hot picks) for fast editing
  - **photo upload from phone or computer** (saved to Drive), or paste links
- **Quote Requests:**
  - Approve creates an account. Service charge received is **unticked by default**.
  - Warnings with a required confirmation for: customers with **overdue payments**, and first purchases above the **first-purchase limit** (Settings; blank = off).
  - Custom requests get their price and service charge at approval. Returning-customer alert.
- **Customers** are grouped by phone number, with email, purchases, payment record and notes.
- **Accounts:**
  - schedule, Edit account (details, email, due dates, reminder settings and snooze, card used)
  - service charge status; one account per purchase
  - **Agreement** button: printable customer agreement (item, price, service charge, monthly amounts, schedule, terms, signature lines); print / save as PDF or copy as text. Have a lawyer review the wording.
- **Payments:** method, reference number, notes, partial payments, remove a mistaken entry.
- **Reminders:**
  - overdue, due today, due soon, with copy-ready messages (overdue wording for late ones)
  - **automatic emails** (on/off in Settings), and "Reminder email sent …" on each customer
- **Shop page:**
  - editable **Good to know** (text, icon, shows on: all / small / large / not groceries / groceries)
  - editable **FAQ** (`{penalty}` and `{deliveryAreas}` placeholders)
  - **month choices for Request any item**
  - banners, Happy customers toggle, reviews approval, customer photos
- **Settings:**
  - **Chat assistant** on/off and **Chat logo** (upload, change, or reset; cropped to a square)
  - shop name, tagline, logo (built in; upload replaces it), Messenger link, owner email, due-soon window, penalty text, reminder template
  - first-purchase limit, automatic email reminders
  - shown to customers: Facebook Page, location, hours, delivery areas, DTI number, privacy email
  - credit cards (nickname + last 4 only), owner password change, copy prototype data to Sheets, JSON export
- **Automatic email reminders** (Apps Script daily trigger, about 9 AM Manila time):
  - one email when the due date is within the window, one on the due date, then weekly while overdue
  - at most 1 per customer per day; logged in the Reminder log tab
  - sent from the owner's Gmail as "AbotVida", replies go to the owner email, about 100 emails a day on free Gmail

## Owner to-do now
1. **Add the Gemini key in Cloudflare:** Workers & Pages → abotvida → Settings → Variables and Secrets → Add → Type: Secret, Name: `GEMINI_API_KEY` → Deploy. The chat bubble stays hidden until this is done.
2. **Paste the latest Code.gs** (Nov 4 night version: `balance` action, `chatOn` and `chatLogo` public settings, chat logo saved to Drive) into Apps Script → Save → Deploy → Manage deployments → Edit → New version → Deploy.
   - Until this is done, Check my balance on the live shop shows a connection error, and the Chat assistant switch and chat logo don't reach customers.
3. In the Sheet: AbotVida → **Set up email reminders**, and allow access.
4. In the dashboard Settings:
   - Messenger link, owner email, exact penalty amount
   - Facebook Page, location, hours, delivery areas, privacy email
   - first-purchase limit (optional)
   - tick Automatic email reminders
5. Add real products and photos. Product import from Abenson is via ChatGPT using the template; leave Image URL blank; check prices by hand.
6. Disconnect the Cloudflare Git build (abotvida → Settings → Build) and delete the old sparkling-fire-ae80 project.

## Decisions and preferences
- Keep the design; changes small; show a preview before pushing live.
- Wording: "Service charge" (never DP or down payment), "Item price" (not cash price).
- No cart, checkout or customer login. No fake urgency, sold counts or reviews.
- Customer side is English only.
- The Owner button stays hidden from visitors.
- Monthly amounts in whole pesos (rounded up; last month smaller).
- Product photos: the owner's own or permitted sources; don't hotlink Abenson images.

## Next steps (suggested)
Done and live Nov 4: customer agreement, Check my balance (by mobile number), This month panel, Products search and filter, AbotVida Assistant chat (Gemini) with editable chat logo, product-aware quick buttons, budget finder and in-chat Request buttons.

On hold until the owner asks:
1. Chat questions log in the owner dashboard (anonymous; flags unanswered questions; needs a privacy-notice line). Then: outside-hours message, gentle product-page chat note.
2. "About AbotVida" section and a link to Facebook Page reviews, for trust.
3. Custom domain (abotvida.com / .ph). When connected, update the og:url and og:image addresses in index.html.
4. Optional: track penalties in balances; per-card limits; a second check on Check my balance.
5. Business:
   - DTI BNRS, BIR, IPOPHL trademark search (name and AV mark)
   - claim social handles and the domain
   - check with the SEC or a lawyer about lending/financing registration and requiring ATM cards
   - have a lawyer review the privacy notice
   - buy on 0% card installment plans; set customer due dates 3–5 days before card due dates
   - back up the Sheet monthly (File → Make a copy)
