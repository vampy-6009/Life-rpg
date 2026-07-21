/**
 * database.js — SQLite (Capacitor Community plugin) as the primary store,
 * with a JSON backup layer for corruption recovery.
 *
 * Persistence strategy (per spec):
 *   - SQLite is the source of truth during normal operation.
 *   - After every meaningful write (quest complete, level up, class change),
 *     we also export a JSON snapshot to Capacitor Preferences as a backup.
 *   - On startup, we try to open/read the SQLite DB. If that fails or the
 *     player table is empty/corrupt, we fall back to the last JSON backup
 *     and rebuild the DB from it, then tell the caller a repair happened
 *     so the UI can show "Your adventure data was repaired."
 *
 * NOTE ON THE ORIGINAL SPEC: it asked for BOTH "Room Database" (native
 * Java) and "Capacitor SQLite plugin" (JS-callable). Those are two
 * separate, incompatible persistence stacks — Room has no bridge to a
 * Capacitor webview. Since the whole UI here is HTML/CSS/JS running in
 * Capacitor, only the Capacitor SQLite plugin actually makes sense; Room
 * would require rewriting the UI as native Android views, which
 * contradicts the "no heavy assets / lightweight JS app" goal. This file
 * implements the SQLite-plugin + JSON-backup hybrid you chose.
 */

import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { Preferences } from '@capacitor/preferences';

const DB_NAME = 'liferpg_database';
const BACKUP_KEY = 'liferpg_json_backup';
const BACKUP_META_KEY = 'liferpg_json_backup_meta';

const sqliteConnection = new SQLiteConnection(CapacitorSQLite);

let db = null;
let didRepairThisSession = false;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS player (
  player_id INTEGER PRIMARY KEY CHECK (player_id = 1),
  username TEXT NOT NULL,
  class TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 0,
  health INTEGER NOT NULL DEFAULT 100,
  energy INTEGER NOT NULL DEFAULT 100,
  created_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quest (
  quest_id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  reward_xp INTEGER NOT NULL DEFAULT 0,
  reward_coin INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  skill_id INTEGER PRIMARY KEY CHECK (skill_id = 1),
  strength INTEGER NOT NULL DEFAULT 0,
  intelligence INTEGER NOT NULL DEFAULT 0,
  discipline INTEGER NOT NULL DEFAULT 0,
  creativity INTEGER NOT NULL DEFAULT 0
);
`;

/** Opens (creating if needed) the SQLite connection and applies schema. */
async function openDatabase() {
  const isConn = (await sqliteConnection.isConnection(DB_NAME, false)).result;
  if (isConn) {
    db = await sqliteConnection.retrieveConnection(DB_NAME, false);
  } else {
    db = await sqliteConnection.createConnection(DB_NAME, false, 'no-encryption', 1, false);
  }
  await db.open();
  await db.execute(SCHEMA);
  return db;
}

/** Basic integrity check: DB opens, schema present, player row is readable. */
async function verifyIntegrity() {
  try {
    const result = await db.query('SELECT * FROM player WHERE player_id = 1;');
    return { ok: true, hasPlayer: (result.values?.length ?? 0) > 0 };
  } catch (err) {
    console.warn('Integrity check failed:', err);
    return { ok: false, hasPlayer: false };
  }
}

async function writeJsonBackup() {
  try {
    const player = await getPlayer();
    const quests = await getAllQuests();
    const skills = await getSkills();
    const payload = { player, quests, skills, savedAt: new Date().toISOString() };
    await Preferences.set({ key: BACKUP_KEY, value: JSON.stringify(payload) });
    await Preferences.set({ key: BACKUP_META_KEY, value: payload.savedAt });
  } catch (err) {
    // A failed backup must never block the primary write that triggered it.
    console.warn('Failed to write JSON backup:', err);
  }
}

async function readJsonBackup() {
  try {
    const { value } = await Preferences.get({ key: BACKUP_KEY });
    if (!value) return null;
    return JSON.parse(value);
  } catch (err) {
    console.warn('Failed to read JSON backup:', err);
    return null;
  }
}

async function restoreFromBackup(backup) {
  if (!backup?.player) return false;
  const p = backup.player;
  await db.run(
    `INSERT OR REPLACE INTO player
      (player_id, username, class, level, xp, coins, health, energy, created_date)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [p.username, p.class, p.level, p.xp, p.coins, p.health, p.energy, p.created_date]
  );

  if (backup.skills) {
    const s = backup.skills;
    await db.run(
      `INSERT OR REPLACE INTO skills (skill_id, strength, intelligence, discipline, creativity)
       VALUES (1, ?, ?, ?, ?);`,
      [s.strength, s.intelligence, s.discipline, s.creativity]
    );
  }

  if (Array.isArray(backup.quests)) {
    for (const q of backup.quests) {
      await db.run(
        `INSERT INTO quest (title, description, reward_xp, reward_coin, completed, date)
         VALUES (?, ?, ?, ?, ?, ?);`,
        [q.title, q.description, q.reward_xp, q.reward_coin, q.completed, q.date]
      );
    }
  }
  return true;
}

/**
 * Call once on app startup.
 * Returns { repaired: boolean, hasPlayer: boolean } so the caller can
 * decide whether to show character creation or the dashboard, and
 * whether to show the "data was repaired" message.
 */
export async function initDatabase() {
  await openDatabase();
  const integrity = await verifyIntegrity();

  if (!integrity.ok) {
    // DB itself is unreadable/corrupt — rebuild schema and try backup restore.
    console.warn('Database corruption detected — attempting restore from backup.');
    try {
      await db.close();
    } catch (_) {
      /* ignore close errors on an already-broken connection */
    }
    await sqliteConnection.closeConnection(DB_NAME, false).catch(() => {});
    await openDatabase();

    const backup = await readJsonBackup();
    if (backup) {
      await restoreFromBackup(backup);
      didRepairThisSession = true;
      return { repaired: true, hasPlayer: true };
    }
    return { repaired: true, hasPlayer: false };
  }

  if (!integrity.hasPlayer) {
    // Fresh install or player table empty — check if a backup exists anyway
    // (e.g. app data partially cleared but Preferences survived).
    const backup = await readJsonBackup();
    if (backup?.player) {
      await restoreFromBackup(backup);
      didRepairThisSession = true;
      return { repaired: true, hasPlayer: true };
    }
    return { repaired: false, hasPlayer: false };
  }

  return { repaired: false, hasPlayer: true };
}

export function wasRepairedThisSession() {
  return didRepairThisSession;
}

/* ---------------- Player ---------------- */

export async function createPlayer({ username, playerClass }) {
  const created = new Date().toISOString();
  await db.run(
    `INSERT OR REPLACE INTO player
      (player_id, username, class, level, xp, coins, health, energy, created_date)
     VALUES (1, ?, ?, 1, 0, 0, 100, 100, ?);`,
    [username, playerClass, created]
  );
  await db.run(
    `INSERT OR REPLACE INTO skills (skill_id, strength, intelligence, discipline, creativity)
     VALUES (1, 0, 0, 0, 0);`
  );
  await writeJsonBackup();
  return getPlayer();
}

export async function getPlayer() {
  const result = await db.query('SELECT * FROM player WHERE player_id = 1;');
  return result.values?.[0] ?? null;
}

export async function updatePlayer(fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return getPlayer();
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => fields[k]);
  await db.run(`UPDATE player SET ${setClause} WHERE player_id = 1;`, values);
  await writeJsonBackup();
  return getPlayer();
}

/* ---------------- Skills ---------------- */

export async function getSkills() {
  const result = await db.query('SELECT * FROM skills WHERE skill_id = 1;');
  return result.values?.[0] ?? { strength: 0, intelligence: 0, discipline: 0, creativity: 0 };
}

export async function addSkillPoints(deltas) {
  const current = await getSkills();
  const next = {
    strength: current.strength + (deltas.strength ?? 0),
    intelligence: current.intelligence + (deltas.intelligence ?? 0),
    discipline: current.discipline + (deltas.discipline ?? 0),
    creativity: current.creativity + (deltas.creativity ?? 0),
  };
  await db.run(
    `UPDATE skills SET strength = ?, intelligence = ?, discipline = ?, creativity = ? WHERE skill_id = 1;`,
    [next.strength, next.intelligence, next.discipline, next.creativity]
  );
  await writeJsonBackup();
  return next;
}

/* ---------------- Quests ---------------- */

export async function getAllQuests() {
  const result = await db.query('SELECT * FROM quest ORDER BY quest_id DESC;');
  return result.values ?? [];
}

export async function getTodaysQuests() {
  const today = new Date().toISOString().slice(0, 10);
  const result = await db.query('SELECT * FROM quest WHERE date = ? ORDER BY quest_id ASC;', [today]);
  return result.values ?? [];
}

export async function addQuest({ title, description, rewardXp, rewardCoin }) {
  const today = new Date().toISOString().slice(0, 10);
  await db.run(
    `INSERT INTO quest (title, description, reward_xp, reward_coin, completed, date)
     VALUES (?, ?, ?, ?, 0, ?);`,
    [title, description ?? '', rewardXp, rewardCoin, today]
  );
  await writeJsonBackup();
  return getTodaysQuests();
}

export async function completeQuest(questId) {
  await db.run(`UPDATE quest SET completed = 1 WHERE quest_id = ?;`, [questId]);
  await writeJsonBackup();
}

/* ---------------- Manual backup controls (exposed for Settings later) ---------------- */

export async function createBackupNow() {
  await writeJsonBackup();
}

export async function getLastBackupTime() {
  const { value } = await Preferences.get({ key: BACKUP_META_KEY });
  return value ?? null;
}
