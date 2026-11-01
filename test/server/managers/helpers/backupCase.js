const assert = require('node:assert/strict')
const { createFixture } = require('./backupHarness')

async function run(sourcePath, scenario, caller = false) {
  const { manager, stats } = createFixture(sourcePath, scenario, caller)
  let deadline
  try {
    await Promise.race([
      (async () => {
        if (caller) {
          manager.zipBackup = async () => { stats.zip++; return true }
          const result = await manager.runBackup()
          assert.equal(result, false)
          assert.equal(stats.zip, 0)
          assert.equal(stats.notifications, 1)
          assert.equal(stats.close, 1)
          assert.equal(stats.remove, 1)
          return
        }
        const good = ['success', 'duplicate'].includes(scenario)
        await manager.backupSqliteDb({ id: 'test' }).then(p => {
          stats.settlements++; stats.zip++
          assert.equal(good, true)
          assert.equal(p, '/fixture/absdatabase.test.sqlite')
        }, e => {
          stats.settlements++
          assert.equal(good, false)
          assert.ok(e)
        })
        await new Promise(r => setTimeout(r, 15))
        assert.equal(stats.settlements, 1)
        assert.equal(stats.close, 1)
        assert.equal(stats.zip, good ? 1 : 0)
        assert.equal(stats.remove, good ? 0 : 1)
        if (!['open-error', 'init-error', 'backup-throw'].includes(scenario)) assert.equal(stats.finish, 1)
        if (['open-error', 'init-error'].includes(scenario)) assert.equal(stats.step, 0)
      })(),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('fixture deadline')), 600) })
    ])
  } finally {
    clearTimeout(deadline)
  }
  return stats
}

module.exports = { run }
if (require.main === module) {
  run(process.argv[2], process.argv[3], process.argv[4] === 'caller').then(stats => {
    console.log(JSON.stringify({ pass: true, stats }))
  }, error => {
    console.error(error.stack)
    process.exitCode = 1
  })
}
