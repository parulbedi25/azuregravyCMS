import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    csrfToken?: string;
    flash?: Array<{ type: 'success' | 'error' | 'info' | 'warning'; message: string }>;
    viewedPosts?: number[];
  }
}
