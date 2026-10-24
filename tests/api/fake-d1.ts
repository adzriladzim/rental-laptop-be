// In-memory D1 adapter backed by node:sqlite (built into Node 22.5+).
// Exposes the minimal D1 surface that drizzle-orm/d1 drives:
//   prepare(sql) -> stmt.bind(...params) -> { all(), raw(), run(), first() }
// Used only by API integration tests to run the Hono app in-process.
//
// Cloudflare D1 quirks handled here:
//  - drizzle emits backtick-quoted identifiers; node:sqlite wants double quotes.
//  - D1 `.all()` returns { results: Row[] }, `.raw()` returns unknown[][],
//    `.run()` returns { meta: { changes } }.

import { DatabaseSync } from 'node:sqlite'

// Convert Cloudflare/D1 backtick identifiers to SQLite double-quote identifiers.
// NB: backticks inside string literals are not handled — none of the queries
// emitted by this codebase contain backticks inside literals.
function normalize(sql: string): string {
  return sql.replace(/`([^`]+)`/g, (_, id) => `"${id}"`)
}

interface D1Result {
  results: Record<string, unknown>[]
  success: boolean
  meta: { changes: number; duration?: number; size_after?: number }
}

function makeResult(rows: Record<string, unknown>[], changes: number): D1Result {
  return {
    results: rows,
    success: true,
    meta: { changes },
  }
}

export class FakeD1 {
  private db: DatabaseSync

  constructor() {
    this.db = new DatabaseSync(':memory:')
    this.db.exec('PRAGMA foreign_keys = ON')
  }

  /** Execute raw DDL/SQL (used to create schema in setup). */
  exec(sql: string): void {
    this.db.exec(normalize(sql))
  }

  prepare(sql: string) {
    const stmt = this.db.prepare(normalize(sql))
    return {
      bind: (...params: unknown[]) => {
        // node:sqlite StatementSync is synchronous; D1 API is async => wrap.
        return {
          all: async (): Promise<D1Result> => {
            const rows = stmt.all(...params) as Record<string, unknown>[]
            return makeResult(rows, 0)
          },
          raw: async (): Promise<unknown[][]> => {
            const rows = stmt.all(...params) as Record<string, unknown>[]
            return rows.map((r) => Object.values(r))
          },
          run: async (): Promise<D1Result> => {
            const { changes } = stmt.run(...params)
            return makeResult([], Number(changes))
          },
          first: async (): Promise<Record<string, unknown> | null> => {
            const row = stmt.get(...params) as Record<string, unknown> | undefined
            return row ?? null
          },
        }
      },
    }
  }

  async batch(statements: { all?: () => Promise<D1Result>; run?: () => Promise<D1Result> }[]) {
    const out = []
    for (const s of statements) {
      out.push('all' in s && s.all ? await s.all() : await s.run!())
    }
    return out
  }

  close(): void {
    this.db.close()
  }
}
