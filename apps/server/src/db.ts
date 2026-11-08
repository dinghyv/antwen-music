import fs from 'node:fs'
import path from 'node:path'
// Node's own SQLite (node:sqlite), so nothing has to be compiled on install.
import { DatabaseSync } from 'node:sqlite'

// One SQLite file for everything the server keeps. The plugin workers open it
// too, for host.storage and host.setting, which plugins call synchronously.

export function openDatabase(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(path.join(dataDir, 'antwen-music.db'))
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;')
  return db
}

export function migrate(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      avatar TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oidc_states (
      state TEXT PRIMARY KEY,
      verifier TEXT NOT NULL,
      return_to TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      repo TEXT,
      version TEXT,
      ref TEXT,
      route TEXT NOT NULL DEFAULT 'direct',
      enabled INTEGER NOT NULL DEFAULT 1,
      installed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_plugins (
      user_id TEXT NOT NULL,
      plugin_id TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      PRIMARY KEY (user_id, plugin_id)
    );
    CREATE TABLE IF NOT EXISTS plugin_settings (
      user_id TEXT NOT NULL,
      plugin_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (user_id, plugin_id, key)
    );
    CREATE TABLE IF NOT EXISTS plugin_storage (
      user_id TEXT NOT NULL,
      plugin_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (user_id, plugin_id, key)
    );
    CREATE TABLE IF NOT EXISTS prefs (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    );
  `)
}

/** Columns added after a database was first made. */
export function migrateColumns(db: DB) {
  const cols = (db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]).map((c) => c.name)
  if (!cols.includes('site_admin')) db.exec(`ALTER TABLE users ADD COLUMN site_admin INTEGER NOT NULL DEFAULT 0`)
}

export type DB = DatabaseSync

/** The listener's language, as host.language() answers it. */
export function userLanguage(db: DB, userId: string): 'en' | 'zh-CN' {
  const row = db.prepare(`SELECT value FROM prefs WHERE user_id = ? AND key = 'prefs'`).get(userId) as
    | { value: string }
    | undefined
  try {
    const lang = row ? JSON.parse(row.value).language : undefined
    return lang === 'en' ? 'en' : 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}

export function pluginSetting(db: DB, userId: string, pluginId: string, key: string): string {
  const row = db
    .prepare(`SELECT value FROM plugin_settings WHERE user_id = ? AND plugin_id = ? AND key = ?`)
    .get(userId, pluginId, key) as { value: string } | undefined
  return row?.value ?? ''
}

export function pluginStorageRaw(db: DB, userId: string, pluginId: string, key: string): string | undefined {
  const row = db
    .prepare(`SELECT value FROM plugin_storage WHERE user_id = ? AND plugin_id = ? AND key = ?`)
    .get(userId, pluginId, key) as { value: string } | undefined
  return row?.value
}
