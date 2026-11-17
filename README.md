
### Step-by-Step Guide to Deploy

#### Step 1: Log into Cloudflare from Wrangler
Open your terminal in `path-to-repo\gcal-proxy-server` and run:
```bash
npx wrangler login
```
This will open your browser to authorize Wrangler with your free Cloudflare account.

---

#### Step 2: (Optional) Local Testing with `.dev.vars`
For local development with `npm run dev`, create a `.dev.vars` file (which is gitignored) by copying the example template:
```bash
cp .dev.vars.example .dev.vars
```
Fill in your credentials in `.dev.vars`, then run:
```bash
npm run dev
```
You can visit `http://localhost:8787/` to verify it returns `{"status":"ok","service":"gcal-proxy-server","runtime":"Cloudflare Workers (Hono)"}`.

---

#### Step 3: Configure Cloudflare Worker Secrets
Cloudflare stores production secrets encrypted on their edge. Run the following commands in your terminal to set your environment variables (you will be prompted to paste each value securely):

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put MICROSOFT_CLIENT_ID
```

> **Tip:** You can view, add, or edit these secrets anytime directly from the **Cloudflare Dashboard** > **Workers & Pages** > `gcal-proxy-server` > **Settings** > **Variables and Secrets**.

---

#### Step 4: Deploy the Worker
Run the deployment script:
```bash
npm run deploy
```

Wrangler will package your worker and upload it to Cloudflare's global edge network.

---

#### Step 5: Extract Your Worker URL
At the end of the `npm run deploy` output, Wrangler displays your live Worker URL:
```text
Total Upload: 99.85 KiB / gzip: 24.19 KiB
Uploaded gcal-proxy-server (0.85 sec)
Deployed gcal-proxy-server triggers (0.34 sec)
  https://gcal-proxy-server.<your-subdomain>.workers.dev
Current Version ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Your base URL is:
```
https://gcal-proxy-server.<your-subdomain>.workers.dev
```

You can also find this URL anytime by going to:
[dash.cloudflare.com](https://dash.cloudflare.com) > **Workers & Pages** > **`gcal-proxy-server`**.

---

#### Step 6: Verify the Deployment
Run a quick health check in PowerShell or terminal:
```bash
curl https://gcal-proxy-server.<your-subdomain>.workers.dev/
```
Expected response:
```json
{"status":"ok","service":"gcal-proxy-server","runtime":"Cloudflare Workers (Hono)"}
```