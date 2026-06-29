// Minimale type-shim voor de ingebouwde node:sqlite (nog niet in @types/node ^20).
// Runtime is aanwezig in Node 22.5+/25; dit dekt alleen wat we gebruiken.
declare module "node:sqlite" {
  export interface StatementSync {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }
  export class DatabaseSync {
    constructor(path: string, options?: Record<string, unknown>);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
