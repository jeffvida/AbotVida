# AbotVida

Installment (hulugan) shop website: gadgets, appliances and furniture.

- `site/` — the website Cloudflare publishes (`index.html` plus logo and icons). The owner dashboard is at `/#owner`.
- `apps-script/` — the Google Sheets backend (`Code.gs`) and setup steps (`SETUP.md`). This code runs in Google Apps Script, not on Cloudflare.
- `wrangler.jsonc` — tells Cloudflare to serve the `site/` folder.

Every push to `main` updates the live site.
