export const DB_VERSION = '0.1.0';

// Re-export migration SQL for programmatic use
export { default as migration001 } from './migrations/001_initial.sql';
