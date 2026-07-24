import { writeFile } from "node:fs/promises";

const required = ["CLOUDFLARE_D1_DATABASE_ID", "CLOUDFLARE_R2_BUCKET_NAME", "PAGES_ALLOWED_ORIGIN"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing deployment values: ${missing.join(", ")}`);

const config = `name = "renovation-budget-api"
main = "src/index.ts"
compatibility_date = "2026-07-24"

[vars]
ALLOWED_ORIGIN = "${process.env.PAGES_ALLOWED_ORIGIN}"

[[d1_databases]]
binding = "DB"
database_name = "renovation-budget"
database_id = "${process.env.CLOUDFLARE_D1_DATABASE_ID}"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "RECEIPTS"
bucket_name = "${process.env.CLOUDFLARE_R2_BUCKET_NAME}"
`;

await writeFile(new URL("../worker/wrangler.toml", import.meta.url), config);
