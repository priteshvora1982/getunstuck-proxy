# getunstuck.io — GitHub Pages Website

This repo hosts the GetUnstuck website via GitHub Pages.

## Setup (5 minutes)

1. Create a new GitHub repo named exactly: `YOUR-USERNAME.github.io`
   - Or any repo name, then enable GitHub Pages in Settings → Pages

2. Push the contents of this folder to the repo:
   ```bash
   git init
   git add .
   git commit -m "initial"
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
   git push -u origin main
   ```

3. Enable GitHub Pages:
   - Repo → Settings → Pages
   - Source: Deploy from branch → main → / (root)
   - Save

4. Your site will be live at:
   - `https://YOUR-USERNAME.github.io/YOUR-REPO` (if not using username repo)
   - `https://YOUR-USERNAME.github.io` (if repo is named YOUR-USERNAME.github.io)

## Custom Domain (getunstuck.io)

If you have the domain getunstuck.io:

1. Add a file named `CNAME` to this repo with content: `getunstuck.io`
2. In your domain registrar (GoDaddy, Namecheap etc):
   - Add CNAME record: `www` → `YOUR-USERNAME.github.io`
   - Add A records for apex domain pointing to GitHub Pages IPs:
     ```
     185.199.108.153
     185.199.109.153
     185.199.110.153
     185.199.111.153
     ```
3. Back in GitHub → Settings → Pages → Custom domain → enter `getunstuck.io`
4. Check "Enforce HTTPS"

## Pages

| File | URL | Purpose |
|------|-----|---------|
| index.html | / | Homepage + waitlist |
| privacy.html | /privacy | Privacy policy (required for Chrome Store) |

## Chrome Store URLs to use

Once live, use these in the Chrome Web Store submission:
- Homepage: `https://YOUR-DOMAIN/`
- Privacy Policy: `https://YOUR-DOMAIN/privacy.html`
- Support: `mailto:hello@getunstuck.io`
