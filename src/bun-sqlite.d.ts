declare module "bun:sqlite" {
  export class Database {
    constructor(filename?: string, options?: { create?: boolean; strict?: boolean });
    exec(sql: string): void;
    query<T = unknown, P extends unknown[] = unknown[]>(sql: string): {
      all(...params: P): T[];
      get(...params: P): T | null;
      run(...params: P): void;
    };
  }
}
