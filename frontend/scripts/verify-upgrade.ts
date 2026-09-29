import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import Dexie from 'dexie'

// 模拟线上 v2 旧库：四张表、runs 无 developerId、developers 靠 usedRolls 计数、无 usages 表
const legacy = new Dexie('gbfilmdev-db')
legacy.version(1).stores({
  films: '++id, model, format, expireDate, rollsLeft',
  developers: '++id, category, state, mixedAt',
  recipes: '++id, filmId, developerId, dilution, pushPull, tempC',
  runs: '++id, recipeId, runDate, tankType'
})
legacy.version(2).stores({
  films: '++id, model, format, expireDate, rollsLeft',
  developers: '++id, category, state, mixedAt',
  recipes: '++id, filmId, developerId, dilution, pushPull, tempC',
  runs: '++id, recipeId, runDate, tankType'
})

await legacy.open()
await legacy.table('developers').bulkAdd([
  { id: 1, name: '柯达 D-76 工作液 A', category: 'D-76', dilution: '1:1', volumeMl: 1000, mixedAt: '2026-09-12', maxRolls: 12, usedRolls: 4, state: '在用', schemaRev: 2 },
  { id: 2, name: '伊尔福 HC-110 稀释液', category: 'HC-110', dilution: '1:3', volumeMl: 1000, mixedAt: '2026-09-16', maxRolls: 16, usedRolls: 8, state: '在用', schemaRev: 2 },
  { id: 3, name: '罗迪纳尔 高稀释工作液', category: 'Rodinal', dilution: '1:3', volumeMl: 500, mixedAt: '2026-08-28', maxRolls: 10, usedRolls: 10, state: '在用', schemaRev: 2 },
  { id: 4, name: '柯达 C-41 彩色套药', category: 'C-41', dilution: '1:3', volumeMl: 1000, mixedAt: '2026-09-20', maxRolls: 12, usedRolls: 0, state: '新配', schemaRev: 2 },
  { id: 5, name: '旧版 D-76 补充液', category: 'D-76', dilution: '1:1', volumeMl: 750, mixedAt: '2026-05-10', maxRolls: 10, usedRolls: 10, state: '报废', schemaRev: 2 }
])
await legacy.table('recipes').bulkAdd([
  { id: 1, filmId: 1, developerId: 1, dilution: '1:1', tempC: 20, devMinutes: 9.5, schemaRev: 2 },
  { id: 2, filmId: 2, developerId: 2, dilution: '1:3', tempC: 20, devMinutes: 7.5, schemaRev: 2 },
  { id: 3, filmId: 3, developerId: 4, dilution: '1:3', tempC: 38, devMinutes: 3.25, schemaRev: 2 },
  { id: 4, filmId: 4, developerId: 3, dilution: '1:3', tempC: 20, devMinutes: 11, schemaRev: 2 },
  { id: 5, filmId: 5, developerId: 1, dilution: '1:1', tempC: 24, devMinutes: 6.5, schemaRev: 2 },
  { id: 6, filmId: 1, developerId: 1, dilution: '1:1', tempC: 20, devMinutes: 12.5, schemaRev: 2 },
  { id: 7, filmId: 2, developerId: 3, dilution: '1:3', tempC: 20, devMinutes: 13, schemaRev: 2 }
])
await legacy.table('runs').bulkAdd([
  { id: 1, batchNo: 'R-260918-01', recipeId: 1, actualTempC: 20.2, actualMinutes: 9.4, tankType: '双联罐', runDate: '2026-09-18', result: '密度均匀', schemaRev: 2 },
  { id: 2, batchNo: 'R-260920-02', recipeId: 2, actualTempC: 20.5, actualMinutes: 7.2, tankType: '双联罐', runDate: '2026-09-20', result: '暗部略薄', schemaRev: 2 },
  { id: 3, batchNo: 'R-260921-03', recipeId: 3, actualTempC: 38.1, actualMinutes: 3.25, tankType: '深罐', runDate: '2026-09-21', result: '肤色自然', schemaRev: 2 },
  { id: 4, batchNo: 'R-260922-04', recipeId: 4, actualTempC: 19.8, actualMinutes: 11.2, tankType: '双联罐', runDate: '2026-09-22', result: '反差合适', schemaRev: 2 },
  { id: 5, batchNo: 'R-260923-05', recipeId: 5, actualTempC: 24.2, actualMinutes: 6.4, tankType: '深罐', runDate: '2026-09-23', result: '高光保留', schemaRev: 2 },
  { id: 6, batchNo: 'R-260924-06', recipeId: 6, actualTempC: 19.5, actualMinutes: 13.2, tankType: '双联罐', runDate: '2026-09-24', result: '反差稍强', schemaRev: 2 },
  { id: 7, batchNo: 'R-260925-07', recipeId: 7, actualTempC: 20.1, actualMinutes: 12.8, tankType: '双联罐', runDate: '2026-09-25', result: '阴影不足', schemaRev: 2 }
])
await legacy.close()

// 用新版（v3）打开同一数据库，触发升级补齐
const { db } = await import('../src/utils/db')
await db.open()
assert.equal(db.verno, 3, '数据库应升级到 v3')

const runs = await db.runs.orderBy('id').toArray()
assert.ok(runs.every((run) => run.schemaRev === 3), '所有批次 schemaRev 升到 3')
assert.ok(runs.every((run) => typeof run.developerId === 'number'), '所有批次补齐显影液快照')
assert.deepEqual(runs.map((run) => run.developerId), [1, 2, 4, 3, 1, 1, 3])

const usages = await db.usages.orderBy('id').toArray()
const batchUsages = usages.filter((usage) => usage.kind === 'batch')
assert.equal(batchUsages.length, 7, '每条旧批次补一条流水')
assert.ok(batchUsages.every((usage) => usage.status === 'active' && usage.rolls === 1))
assert.deepEqual(batchUsages.map((usage) => usage.runId).sort((a, b) => (a ?? 0) - (b ?? 0)), [1, 2, 3, 4, 5, 6, 7])
assert.ok(batchUsages.every((usage) => usage.batchNo && usage.consumedAt), '流水带批次号与消耗日期')

// 升级后账本 = 批次流水 + 期初流水；旧计数低于实际批次的（dev4 记 0 却有 1 批实冲）以批次为准
const usedByDeveloper = new Map<number, number>()
usages.filter((usage) => usage.status === 'active').forEach((usage) => {
  usedByDeveloper.set(usage.developerId, (usedByDeveloper.get(usage.developerId) ?? 0) + usage.rolls)
})
const expectedUsed = new Map([[1, 4], [2, 8], [3, 10], [4, 1], [5, 10]])
expectedUsed.forEach((expected, developerId) => {
  assert.equal(usedByDeveloper.get(developerId) ?? 0, expected, `developer ${developerId} 账本汇总应符合预期`)
})
const openings = usages.filter((usage) => usage.kind === 'opening')
assert.deepEqual(
  openings.map((usage) => [usage.developerId, usage.rolls]).sort((a, b) => a[0] - b[0]),
  [[1, 1], [2, 7], [3, 8], [5, 10]],
  '旧计数中超出批次的余量补为期初流水'
)
console.log('✓ upgrade: v2→v3 自动补齐流水，用量与旧计数完全一致')

// 升级后的库上继续走登记/撤销流程
const runId = await db.transaction('rw', db.runs, db.recipes, db.developers, db.usages, async () => {
  const recipe = await db.recipes.get(1)
  assert.ok(recipe)
  const newRunId = await db.runs.add({
    batchNo: 'R-260929-08', recipeId: 1, developerId: recipe.developerId,
    actualTempC: 20, actualMinutes: 9.5, tankType: '双联罐', runDate: '2026-09-29',
    result: '升级后首冲', schemaRev: 3
  })
  await db.usages.add({
    developerId: recipe.developerId, runId: newRunId, batchNo: 'R-260929-08',
    kind: 'batch', rolls: 1, consumedAt: '2026-09-29', status: 'active', schemaRev: 3
  })
  return newRunId
})
const dev1AfterAdd = await db.usages.where('developerId').equals(1).toArray()
assert.equal(dev1AfterAdd.filter((usage) => usage.status === 'active').reduce((sum, usage) => sum + usage.rolls, 0), 5)

// 撤销刚登记的批次：只冲销它自己的流水
await db.transaction('rw', db.runs, db.usages, async () => {
  const linked = await db.usages.where('runId').equals(runId).toArray()
  assert.equal(linked.length, 1)
  await db.usages.update(linked[0].id, { status: 'reversed', reversedAt: '2026-09-29', reverseReason: '撤销批次 R-260929-08' })
  await db.runs.delete(runId)
})
const dev1AfterRevoke = await db.usages.where('developerId').equals(1).toArray()
assert.equal(dev1AfterRevoke.filter((usage) => usage.status === 'active').reduce((sum, usage) => sum + usage.rolls, 0), 4, '余量还原到升级补齐后的水平')
assert.equal(dev1AfterRevoke.filter((usage) => usage.status === 'reversed').length, 1, '冲销流水留痕')
const otherBatches = await db.usages.where('kind').equals('batch').and((usage) => usage.status === 'active').count()
assert.equal(otherBatches, 7, '其他批次流水不受影响')
console.log('✓ upgrade+ledger: 升级后登记/撤销/冲销行为正确')

await db.close()
console.log('\nUPGRADE TESTS PASSED')
