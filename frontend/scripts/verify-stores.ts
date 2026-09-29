import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '../src/utils/db'
import { useRunStore } from '../src/stores/runStore'
import { useUsageStore } from '../src/stores/usageStore'
import { useDeveloperStore } from '../src/stores/developerStore'

setActivePinia(createPinia())
await db.open()

const runStore = useRunStore()
const usageStore = useUsageStore()
const developerStore = useDeveloperStore()
await Promise.all([runStore.load(), usageStore.load(), developerStore.load()])

const activeUsed = (developerId: number) => usageStore.usages
  .filter((usage) => usage.status === 'active' && usage.developerId === developerId)
  .reduce((sum, usage) => sum + usage.rolls, 0)

// 初始种子：dev1 账本用量 4、剩余 8
assert.equal(activeUsed(1), 4)
assert.equal(developerStore.remainingFor(1), 8)
assert.equal(developerStore.availableRolls, (12 - 4) + (16 - 8) + (10 - 10) + (12 - 1), '在用工作液可冲余量合计')

// 登记实冲：批次、配方、显影液快照 + 流水一起写入
const result = await runStore.addRun({
  batchNo: 'R-260929-08', recipeId: 1,
  actualTempC: 20.1, actualMinutes: 9.5, tankType: '双联罐',
  runDate: '2026-09-29', result: '账本首冲'
})
assert.ok(result.runId > 0 && result.usageId > 0)
assert.equal(result.developerId, 1)
await usageStore.load()
const savedRun = await db.runs.get(result.runId)
assert.equal(savedRun?.developerId, 1, '批次写入显影液快照')
assert.equal(activeUsed(1), 5)
assert.equal(developerStore.usedRollsFor(1), 5)

// 第二批次
const second = await runStore.addRun({
  batchNo: 'R-260929-09', recipeId: 1,
  actualTempC: 20.1, actualMinutes: 9.5, tankType: '双联罐',
  runDate: '2026-09-29', result: '账本第二冲'
})
await usageStore.load()
assert.equal(activeUsed(1), 6)

// 撤销第一批次：只冲销对应流水，余量还原，第二批次不受影响
await runStore.revokeRun(result.runId)
await runStore.load()
await usageStore.load()
assert.equal(activeUsed(1), 5, '撤销后余量只还原一卷')
assert.equal(await db.runs.get(result.runId), undefined, '批次记录已删除')
const reversed = await db.usages.get(result.usageId)
assert.equal(reversed?.status, 'reversed', '对应流水被冲销')
assert.ok(reversed?.reversedAt && reversed?.reverseReason)
const secondUsage = await db.usages.get(second.usageId)
assert.equal(secondUsage?.status, 'active', '后来批次的流水不受影响')
assert.equal(developerStore.remainingFor(1), 7)
console.log('✓ store: 登记/撤销/只冲销对应流水/余量还原 全部正确')

// 错误路径：配方不存在，事务整体回滚
const runCountBefore = await db.runs.count()
const usageCountBefore = await db.usages.count()
await assert.rejects(
  () => runStore.addRun({
    batchNo: 'BAD-RECIPE', recipeId: 9999,
    actualTempC: 20, actualMinutes: 9, tankType: '双联罐',
    runDate: '2026-09-29', result: '不应保存'
  }),
  /配方不存在/
)
assert.equal(await db.runs.count(), runCountBefore, '失败后无半条批次')
assert.equal(await db.usages.count(), usageCountBefore, '失败后无半条流水')
assert.equal(await db.runs.filter((run) => run.batchNo === 'BAD-RECIPE').count(), 0)

// 撤销不存在的批次也要回滚式抛错
await assert.rejects(() => runStore.revokeRun(999999), /不存在/)
console.log('✓ store: 写不进去时整笔登记不留半条记录')

db.close()
console.log('\nSTORE TESTS PASSED')
