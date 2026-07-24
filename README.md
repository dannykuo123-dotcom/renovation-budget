# 家作帳｜GitHub Pages 裝修預算

一個可部署到 GitHub Pages 的裝修預算管理介面。前端使用 GitHub Pages；共用密碼、帳務資料與憑證圖片由 Cloudflare Worker、D1 與 R2 保存。

## 本機開發

```bash
npm install
npm run dev
```

未設定 `web/.env` 時，前端會進入匿名範例模式，輸入任意非空白代碼即可體驗畫面。這個模式的資料不會保存。

要連接雲端 Worker，複製 `web/.env.example` 成 `web/.env`，填入：

```bash
VITE_API_BASE_URL=https://your-worker.your-subdomain.workers.dev
```

本機測試 Worker 時，複製 `worker/wrangler.toml.example` 成 `worker/wrangler.toml`，並複製 `worker/.dev.vars.example` 成 `worker/.dev.vars`。`BUDGET_ACCESS_CODE` 請設定為 `1069`，另為 `SESSION_SIGNING_SECRET` 使用長而隨機的字串。

```bash
npm test
npm run build
```

## 首次雲端設定

1. 在 Cloudflare 建立 D1 資料庫 `renovation-budget` 和 R2 bucket `renovation-budget-receipts`。
2. 在 GitHub 建立公開 Repository，將本專案推送到 `main`。
3. 在 Repository Settings → Secrets and variables → Actions 新增 Secrets：
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_D1_DATABASE_ID`
   - `CLOUDFLARE_R2_BUCKET_NAME`
   - `BUDGET_ACCESS_CODE`（設定為 `1069`）
   - `SESSION_SIGNING_SECRET`（長隨機字串）
4. 新增 Variables：
   - `VITE_API_BASE_URL`：Worker 的完整 HTTPS 網址
   - `PAGES_ALLOWED_ORIGIN`：`https://<GitHub帳號>.github.io/<Repository名稱>`
5. 在 Repository Settings → Pages 將 Source 選為 **GitHub Actions**。

推送到 `main` 後，工作流程會先測試，再套用 D1 migration、部署 Worker，最後部署 GitHub Pages。Pull Request 只會測試和建置，不會發布。

## 安全界線

- 公開 Repository 不會保存密碼、帳務資料或附件。
- Worker 只接受 `PAGES_ALLOWED_ORIGIN` 的瀏覽器請求，並以 12 小時 Bearer Token 保護 API。
- 4 位數共用密碼適合作為簡易門禁；請勿在系統內輸入銀行帳號或其他高度敏感資料。
