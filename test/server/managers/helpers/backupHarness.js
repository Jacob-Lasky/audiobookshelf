const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { setImmediate } = require('node:timers')

// Both regression and real runBackup caller tests use the same native API model.
function loadMethods(source, context, includeCaller = false) {
  const start = source.indexOf('  backupSqliteDb(backup) {')
  const end = source.indexOf('  zipBackup(', start)
  assert.ok(start >= 0 && end > start, 'real backup method boundaries')
  let methods = source.slice(start, end)
  if (includeCaller) {
    const callerStart = source.indexOf('  async runBackup() {')
    const callerEnd = source.indexOf('  async removeBackup(', callerStart)
    assert.ok(callerStart >= 0 && callerEnd > callerStart, 'real caller method boundaries')
    methods += ',' + source.slice(callerStart, callerEnd)
  }
  return vm.runInNewContext('({' + methods + '})', context)
}

function createFixture(sourcePath, scenario = 'event', includeCaller = false) {
  const source = fs.readFileSync(sourcePath, 'utf8')
  const stats = { finish: 0, close: 0, remove: 0, zip: 0, step: 0, settlements: 0 }
  let emitter
  const busy = () => Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' })
  class DB extends EventEmitter {
    constructor(p, cb) { super(); if (cb) setImmediate(() => cb(scenario === 'open-error' ? busy() : null)) }
    backup(p, cb) {
      if (scenario === 'backup-throw') throw busy()
      emitter = new EventEmitter(); emitter.completed = false; emitter.failed = false
      emitter.step = (n, callback) => {
        stats.step++; assert.equal(n, -1)
        if (scenario === 'step-throw') throw busy()
        setImmediate(() => {
          if (scenario === 'timeout' || scenario === 'slow-init') return
          if (['event','remove-error'].includes(scenario)) return emitter.emit('error', busy())
          if (scenario === 'step-error') return callback ? callback(busy()) : emitter.emit('error', busy())
          emitter.completed = scenario !== 'incomplete'
          if (callback) callback(null, emitter.completed)
        })
      }
      emitter.finish = (cb) => { stats.finish++; setImmediate(() => {
        if (scenario === 'late-error') emitter.emit('error', busy())
        if (cb) cb(scenario === 'finish-error' ? busy() : null)
        if (scenario === 'duplicate') { if (cb) cb(null); setTimeout(() => emitter.emit('error', busy()), 5) }
      }) }
      if (cb) { const done = () => cb(scenario === 'init-error' ? busy() : null); if (scenario === 'slow-init') setTimeout(done, 65); else setImmediate(done) }
      return emitter
    }
    close(cb) { stats.close++; setImmediate(() => cb(scenario === 'close-error' ? busy() : null)) }
  }

  const manager = loadMethods(source, {
    sqlite3: { Database: DB },
    Database: { dbPath: '/fixture/source.sqlite' },
    Path: path,
    global: { ConfigPath: '/fixture' },
    Backup: class { setData() { this.id = 'test' } },
    NotificationManager: { onBackupFailed() { stats.notifications = (stats.notifications || 0) + 1 } },
    Logger: { error() {}, info() {} },
    fs: {
      ensureDir: async () => {},
      remove: async () => { stats.remove++; if (scenario === 'remove-error') throw busy() }
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms === 120000 ? 40 : 1),
    clearTimeout,
    setImmediate,
    Error
  }, includeCaller)
  return { manager, stats }
}

module.exports = { createFixture, loadMethods }
