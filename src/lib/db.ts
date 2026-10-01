import postgres from 'postgres';

// One shared connection pool, reused across hot reloads in development.
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

export function getSql(): postgres.Sql {
  if (!globalForDb.sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    // prepare: false keeps it compatible with connection poolers (e.g. Supabase in transaction mode).
    globalForDb.sql = postgres(url, { prepare: false, max: 5 });
  }
  return globalForDb.sql;
}
