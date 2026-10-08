// Postgres de teste. Padrão: servidor local na porta 54329 (ver README).
export const PG_BASE = process.env.TEST_DATABASE_URL_BASE ?? "postgres://postgres@localhost:54329";
export const TEMPLATE_DB = "leiloes_template";
export const adminUrl = (db: string) => `${PG_BASE}/${db}`;
