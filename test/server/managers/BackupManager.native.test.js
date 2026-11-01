const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const sqlite3 = require('sqlite3')
const { loadMethods } = require('./helpers/backupHarness')

const open = p => new Promise((resolve, reject) => {
  const db = new sqlite3.Database(p, error => error ? reject(error) : resolve(db))
})
const exec = (db, sql) => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()))
const close = db => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()))

describe('BackupManager native SQLite backup', () => {
  it('copies committed data and rejects a real locked destination without an uncaught error', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abs-backup-test-'))
    const sourcePath = path.resolve(__dirname, '../../../server/managers/BackupManager.js')
    const liveConnections = new Set()
    const trackedOpen = async p => { const db = await open(p); liveConnections.add(db); return db }
    const trackedClose = async db => { await close(db); liveConnections.delete(db) }
    try {
      const db = await trackedOpen(path.join(dir, 'source.sqlite'))
      await exec(db, 'CREATE TABLE proof(value INTEGER); INSERT INTO proof VALUES(17)')
      await trackedClose(db)
      const manager = loadMethods(fs.readFileSync(sourcePath, 'utf8'), {
        sqlite3,
        Database: { dbPath: path.join(dir, 'source.sqlite') },
        Path: path,
        global: { ConfigPath: dir },
        Logger: { error() {} },
        fs: { remove: p => fs.promises.rm(p, { force: true }) },
        setTimeout, clearTimeout, setImmediate: require('node:timers').setImmediate, Error
      })
      const output = await manager.backupSqliteDb({ id: 'success' })
      const saved = await trackedOpen(output)
      const rows = await new Promise((resolve, reject) => saved.all('SELECT * FROM proof', (error, value) => error ? reject(error) : resolve(value)))
      assert.equal(rows[0].value, 17)
      await trackedClose(saved)
      const lockedPath = path.join(dir, 'absdatabase.busy.sqlite')
      const lock = await trackedOpen(lockedPath)
      await exec(lock, 'CREATE TABLE locktest(n); BEGIN EXCLUSIVE; INSERT INTO locktest VALUES(1)')
      await assert.rejects(manager.backupSqliteDb({ id: 'busy' }), error => error.code === 'SQLITE_BUSY')
      assert.equal(fs.existsSync(lockedPath), false)
      await exec(lock, 'ROLLBACK')
      await trackedClose(lock)
    } finally {
      for (const db of liveConnections) await close(db)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
