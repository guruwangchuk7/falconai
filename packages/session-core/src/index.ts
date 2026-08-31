// @falcon/session-core — the shared session substrate used by both the session worker (writes) and
// the web app (reads the panel stream): the event-sourced log, transcript merge, and panel projection.
export * from './eventlog.js';
export * from './merge.js';
export * from './panel.js';
