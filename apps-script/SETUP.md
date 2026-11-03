# Connecting AbotVida to Google Sheets

Do this once, signed in to the Google account that will own the shop's data (ideally a Gmail used only for AbotVida). It takes about 15 minutes.

## 1. Create the sheet
1. Go to sheets.new and name the new sheet **AbotVida Database**.
2. Open **Extensions → Apps Script**.
3. Delete the code that is there, paste everything from `Code.gs`, and press **Save**. Name the project **AbotVida**.

## 2. Set it up
1. Go back to the sheet and reload the page. An **AbotVida** menu appears at the top.
2. Choose **AbotVida → Set up sheets**.
3. Google asks for permission. Choose your account, then **Advanced → Go to AbotVida (unsafe) → Allow**. The warning appears because the script is yours and not published by Google. It needs access to this sheet, a Drive folder for photos, and email for new-request alerts.
4. Choose **AbotVida → Set owner password** and pick a password of at least 8 characters. This is the password for the owner dashboard.

## 3. Publish the connection
1. In Apps Script, click **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**. ("Anyone" lets customers send requests. Your records stay private: the owner data needs your password.)
4. Click **Deploy**, allow access again if asked, and copy the **Web app URL**. It ends in `/exec`.

## 4. Connect the website
Send the Web app URL to Claude, or open `index.html`, find `const API_URL = '';` near the top of the script, and paste the URL between the quotes.

## 5. After the site is hosted
1. Open your site and add `#owner` to the address, for example `https://abotvida.com/#owner`, then sign in.
2. Optional: in **Settings → Data from the prototype**, choose **Copy to Google Sheets** to bring over anything you added in this browser during the prototype.
3. In **Settings**, add your **Owner email** to get an email for each new request.

## Good to know
- Each tab in the sheet is one kind of record (Products, Requests, Accounts and so on). The last column holds the actual data. Make changes in the owner dashboard, not in the sheet.
- Uploaded photos (logo, banners, customer photos) are saved in a Drive folder called **AbotVida images** and shared by link so the shop can show them.
- Forgot the password? In the sheet, use **AbotVida → Set owner password** again. **Sign out all devices** signs out every phone and computer.
- After 8 wrong passwords, sign-in is locked for 15 minutes.
- If `Code.gs` is updated later: paste the new code, then **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The URL stays the same.
- The Claude preview may block connections to Google. The connection is meant to run on the hosted site.
