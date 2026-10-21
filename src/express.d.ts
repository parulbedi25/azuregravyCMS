import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    csrfToken?: string;
    flash?: Array<{ type: 'success' | 'error' | 'info' | 'warning'; message: string }>;
    viewedPosts?: number[];
    /** Values carried between the two installer steps (never the password). */
    installDb?: {
      driver: 'mysql' | 'embedded';
      host: string;
      port: number;
      database: string;
      user: string;
      ssl: boolean;
      createDatabase: boolean;
      server?: string;
      tables?: number;
      ms?: number;
    };
  }
}
