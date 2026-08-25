import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  driver: 'd1-http',
  dbCredentials: {
    dbName: 'laptop-rental-db',
    accountId: process.env.CF_ACCOUNT_ID ?? '',
  },
} satisfies Config;
