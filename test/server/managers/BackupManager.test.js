const { run } = require('./helpers/backupCase')
const path = require('node:path')

const sourcePath = path.resolve(__dirname, '../../../server/managers/BackupManager.js')
const scenarios = ['success', 'event', 'step-error', 'open-error', 'init-error', 'backup-throw', 'step-throw', 'incomplete', 'finish-error', 'close-error', 'timeout', 'late-error', 'duplicate', 'slow-init', 'remove-error']

describe('BackupManager SQLite backup errors and completion', () => {
  for (const scenario of scenarios) {
    it(scenario, () => run(sourcePath, scenario))
  }
  it('real runBackup reports failure once and never archives a failed SQLite copy', () => run(sourcePath, 'event', true))
})
