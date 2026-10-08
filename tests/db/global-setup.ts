// Cria um banco "template" com o shim de auth + todas as migrações.
// Cada arquivo de teste clona esse template (ver helpers.ts), então os testes
// rodam contra o mesmo SQL que vai para o Supabase.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { adminUrl, TEMPLATE_DB } from "./config";

export default async function setup() {
  const admin = new Client({ connectionString: adminUrl("postgres") });
  await admin.connect();
  await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname like 'leiloes_t_%' or datname = $1`, [TEMPLATE_DB]);
  const old = await admin.query(`select datname from pg_database where datname like 'leiloes_t_%'`);
  for (const row of old.rows) await admin.query(`drop database if exists "${row.datname}"`);
  await admin.query(`drop database if exists ${TEMPLATE_DB}`);
  await admin.query(`create database ${TEMPLATE_DB}`);
  await admin.end();

  const db = new Client({ connectionString: adminUrl(TEMPLATE_DB) });
  await db.connect();
  const root = path.resolve(__dirname, "../..");
  await db.query(readFileSync(path.join(root, "supabase/tests/auth-shim.sql"), "utf8"));
  const dir = path.join(root, "supabase/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.query(readFileSync(path.join(dir, file), "utf8"));
    } catch (err) {
      throw new Error(`Falha ao aplicar ${file}: ${(err as Error).message}`);
    }
  }
  await db.end();
}
