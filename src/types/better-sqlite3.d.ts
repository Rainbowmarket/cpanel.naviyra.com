declare module "better-sqlite3" {
  export default class Database {
    constructor(filename: string, options?: Record<string, unknown>);
    exec(sql: string): this;
    prepare(sql: string): {
      run(...params: unknown[]): unknown;
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
    };
    close(): void;
  }
}
