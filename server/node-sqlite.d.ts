// The project's Node type definitions (@types/node 20) are older than the Node it runs on (22.5+),
// which has SQLite built in. This describes the small part of `node:sqlite` the server uses.
declare module "node:sqlite" {
  type Value = string | number | bigint | null | Uint8Array;
  export class StatementSync {
    get(...params: Value[]): Record<string, Value> | undefined;
    all(...params: Value[]): Record<string, Value>[];
    run(...params: Value[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
