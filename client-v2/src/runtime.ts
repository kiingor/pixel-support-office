/**
 * Runtime detection — standalone browser build.
 * Always returns 'browser' since VS Code extension support has been removed.
 */

export type Runtime = 'browser';

export const runtime: Runtime = 'browser';

export const isBrowserRuntime = true;
