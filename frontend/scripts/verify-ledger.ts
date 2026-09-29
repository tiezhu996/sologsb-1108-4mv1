import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import Dexie from 'dexie'
import { createPinia, setActivePinia } from 'pinia'

function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('gbfilmdev-db')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

// ---------- 阶段 A：旧版（v2）库升级 ----------
class LegacyDb extends Dexie {
  constructor() {
    super('gbfilmdev-db')
    this.version(1).stores({
      films: '++id, model, format, expireDate, rollsLeft',
      developers: '++id, category, state, mixedAt',
      recipes: '++id, filmId, developerId, dilution, pushPull, tempC',
      runs: '++id, recipeId, runDate, tankType'
    })
    this.version(2).stores({
      films: '++id, model, format, expireDate, rollsLeft',
      developers: '++id, category, state, mixedAt',
      recipes: '++id, filmId, developerId, dilution, pushPull, tempC',
      runs: '++id, recipeId, runDate, tankType'
    })
  }
}

await deleteDb()
const legacy = new LegacyDb()
await legacy.open()
await legacy.table('films').bulkAdd([
  { id: 1, model: 'GP3', format: '135', boxIso: 100, realIso: 100, emulsionNo: 'x', expireDate: '2027-01-01', rollsLeft: 1, schemaRev: 2 }
])
await legacy.table('developers').bulkAdd([
  { id: 1, name: 'D76', category: 'D-76', dilution: '1:1', volumeMl: 1000, mixedAt: '2026-09-01', maxRolls: 12, usedRolls: 4, state: '在用', schemaRev: 2 },
  { id: 2, name: 'HC110', category: 'HC-110', dilution: '1:3', volumeMl: 1000, mixedAt: '2026-09-05', maxRolls: 16, usedRolls: 0, state: '新配', schemaRev: 2 },
  { id: 3, name: 'Rodinal', category: 'Rodinal', dilution: '1:3', volumeMl: 500, mixedAt: '2026-08-01', maxRolls: 10, usedRolls: 10, state: '在用', schemaRev: 2 }
])
await legacy.table('recipes').bulkAdd([
  { id: 1, filmId: 1, developerId: 1, dilution: '1:1', tempC: 20, devMinutes: 9, agitation: '', stopBath: '', fixer: '', washMinutes: 10, pushPull: 'N', schemaRev: 2 },
  { id: 2, filmId: 1, developerId: 3, dilution: '1:3', tempC: 20, devMinutes: 11, agitation: '', stopBath: '', fixer: '', washMinutes: 10, pushPull: 'N', schemaRev: 2 }
])
await legacy.table('runs').bulkAdd([
  { id: 1, batchNo: 'OLD-01', recipeId: 1, actualTempC: 20, actualMinutes: 9, tankType: '双联罐', runDate: '2026-09-10', result: 'ok', schemaRev: 2 },
  { id: 2, batchNo: 'OLD-02', recipeId: 1, actualTempC: 20, actualMinutes: 9, tankType: '双联罐', runDate: '2026-09-11', result: 'ok', schemaRev: 2 },
  { id: 3, batchNo: 'OLD-03', recipeId: 2, actualTempC: 20, actualMinutes: 11, tankType: '深罐', runDate: '2026-09-12', result: 'ok', schemaRev: 2 },
  { id: 4, batchNo: 'OLD-ORPHAN', recipeId: 999, actualTempC: 20, actualMinutes: 9, tankType: '双联罐', runDate: '2026-09-13', result: 'orphan', schemaRev: 2 }
])
legacy.close()

const { db } = await import('../src/utils/db.ts')

const upgradedRuns = await db.runs.orderBy('id').toArray()
assert.equal(upgradedRuns.length, 4, '旧批次应全部保留')
assert.deepEqual(
  upgradedRuns.map((r) => [r.id, r.developerId, r.revokedAt, r.schemaRev]),
  [[1, 1, null, 3], [2, 1, null, 3], [3, 3, null, 3], [4, 0, null, 3]],
  '旧批次应补显影液快照与撤销字段'
)

const upgradedDevelopers = await db.developers.orderBy('id').toArray()
assert.equal(
  upgradedDevelopers.every((d) => (d as Record<string, unknown>).usedRolls === undefined),
  true,
  '手工计数 usedRolls 应从台账删除'
)
assert.equal(upgradedDevelopers.every((d) => d.schemaRev === 3), true)

const upgradedUsages = await db.usages.orderBy('id').toArray()
const sumFor = (developerId: number) =>
  upgradedUsages.filter((u) => u.developerId === developerId).reduce((s, u) => s + u.quantity, 0)
// dev1：旧计数 4 = 2 条补录 consume + 2 卷期初；dev3：10 = 1 consume + 9 期初；dev2：0 不写 open
assert.equal(sumFor(1), 4, 'dev1 账本汇总应等于旧 usedRolls=4')
assert.equal(sumFor(3), 10, 'dev3 账本汇总应等于旧 usedRolls=10')
assert.equal(sumFor(2), 0, 'dev2 旧计数为 0，不应有流水')
assert.equal(
  upgradedUsages.filter((u) => u.kind === 'consume').length,
  3,
  '应为 3 个有归属的旧批次补 consume（孤儿批次不补）'
)
assert.equal(
  upgradedUsages.filter((u) => u.kind === 'open').reduce((s, u) => s + u.quantity, 0),
  11,
  '期初流水合计应为 2 + 9 = 11'
)
const orphanUsages = upgradedUsages.filter((u) => u.runId === 4)
assert.equal(orphanUsages.length, 0, '孤儿批次不能记到不存在的药上')
console.log('✔ 阶段 A：v2 → v3 自动补齐流水，汇总与旧计数一致')

// ---------- 阶段 B：全新库 populate ----------
db.close()
await deleteDb()
await sleep(50)
await db.open()
const freshUsages = await db.usages.toArray()
const freshSum = (developerId: number) =>
  freshUsages.filter((u) => u.developerId === developerId).reduce((s, u) => s + u.quantity, 0)
assert.deepEqual(
  [1, 2, 3, 4, 5].map(freshSum),
  [4, 8, 10, 1, 10],
  '种子账本汇总应分别为 4/8/10/1/10'
)
console.log('✔ 阶段 B：全新库种子数据自带流水')

// ---------- 阶段 C：登记 / 撤销（走真实 store + 事务） ----------
setActivePinia(createPinia())
const { useRunStore } = await import('../src/stores/runStore.ts')
const { useDeveloperStore } = await import('../src/stores/developerStore.ts')
const runStore = useRunStore()
const developerStore = useDeveloperStore()
await Promise.all([runStore.load(), developerStore.load()])

assert.equal(developerStore.usedByDeveloper(4), 1, 'dev4（C-41）初始用量 1')
assert.equal(developerStore.remainingByDeveloper(4), 11, 'dev4 剩余 11')

const runIdA = await runStore.addRun({
  batchNo: 'NEW-A', recipeId: 3,
  actualTempC: 38, actualMinutes: 3.25, tankType: '深罐', runDate: '2026-09-26', result: 'A'
})
assert.equal(developerStore.usedByDeveloper(4), 1, 'store 尚未 reload，内存数据不变')
await developerStore.load()
assert.equal(developerStore.usedByDeveloper(4), 2, '登记后 dev4 用量 2')
assert.equal(developerStore.remainingByDeveloper(4), 10, '登记后剩余 10')
const runA = await db.runs.get(runIdA)
assert.equal(runA?.developerId, 4, '批次应快照所用显影液')
assert.equal(runA?.revokedAt, null)

const runIdB = await runStore.addRun({
  batchNo: 'NEW-B', recipeId: 3,
  actualTempC: 38, actualMinutes: 3.25, tankType: '深罐', runDate: '2026-09-27', result: 'B'
})
await developerStore.load()
assert.equal(developerStore.usedByDeveloper(4), 3, '两笔登记后用量 3')

// 撤销 A：只冲销 A 的流水，B 不受影响
await runStore.revokeRun(runIdA)
await developerStore.load()
assert.equal(developerStore.usedByDeveloper(4), 2, '撤销 A 后用量回到 2（B 仍计）')
assert.equal(developerStore.remainingByDeveloper(4), 10, '剩余次数还原为 10')
const runARevoked = await db.runs.get(runIdA)
assert.ok(runARevoked?.revokedAt, '撤销后批次应带 revokedAt')
const runB = await db.runs.get(runIdB)
assert.equal(runB?.revokedAt, null, '后来的批次不受影响')
assert.equal(runStore.activeRuns.some((r) => r.id === runIdA), false, '撤销批次不出现在有效记录')
assert.equal(runStore.activeRuns.some((r) => r.id === runIdB), true, '后来批次仍在有效记录')

const aEntries = await db.usages.where('runId').equals(runIdA).toArray()
assert.equal(aEntries.length, 2, '原 consume 与 reversal 应同时保留（追加不删除）')
assert.deepEqual(aEntries.map((e) => e.kind).sort(), ['consume', 'reversal'])
const consume = aEntries.find((e) => e.kind === 'consume')!
const reversal = aEntries.find((e) => e.kind === 'reversal')!
assert.equal(reversal.quantity, -1, '冲销流水数量为 -1')
assert.equal(reversal.reversesId, consume.id, '冲销应指向原流水')
assert.equal(consume.reversedById, reversal.id, '原流水应记录被谁冲销')
await assert.rejects(() => runStore.revokeRun(runIdA), /已经撤销/, '重复撤销必须拒绝')
console.log('✔ 阶段 C：登记入账、撤销只冲销本批流水、他批不受影响、防重复撤销')

// ---------- 阶段 D：原子性，写不进去不留半条记录 ----------
const runsBefore = await db.runs.count()
const usagesBefore = await db.usages.count()
await assert.rejects(
  () => runStore.addRun({
    batchNo: 'BAD-NO-RECIPE', recipeId: 404,
    actualTempC: 20, actualMinutes: 9, tankType: '双联罐', runDate: '2026-09-28', result: 'x'
  }),
  /配方不存在/,
  '配方不存在应拒绝登记'
)
assert.equal(await db.runs.count(), runsBefore, '失败后不能多出批次')
assert.equal(await db.usages.count(), usagesBefore, '失败后不能多出流水')

// 模拟“批次已写入、流水写入失败”：让 usages.add 一次性抛错
const originalAdd = db.usages.add.bind(db.usages)
let sabotage = true
db.usages.add = ((...args: unknown[]) => {
  const entry = args[0] as { kind?: string }
  if (sabotage && entry?.kind === 'consume') {
    sabotage = false
    return Promise.reject(new Error('simulated quota error'))
  }
  return originalAdd(...(args as [never]))
}) as typeof db.usages.add
await assert.rejects(
  () => runStore.addRun({
    batchNo: 'BAD-HALF', recipeId: 3,
    actualTempC: 38, actualMinutes: 3.25, tankType: '深罐', runDate: '2026-09-29', result: 'x'
  }),
  /simulated quota error/,
  '流水写失败应整体抛错'
)
db.usages.add = originalAdd
assert.equal(await db.runs.count(), runsBefore, '事务回滚：批次半条都不能留')
assert.equal(await db.usages.count(), usagesBefore, '事务回滚：流水半条都不能留')
assert.equal(
  (await db.runs.toArray()).filter((r) => r.batchNo === 'BAD-HALF').length,
  0
)
console.log('✔ 阶段 D：任一步写失败，整笔登记回滚不留半条记录')

// ---------- 阶段 E：撤销同样原子 ----------
const revokeRunsBefore = await db.runs.count()
const revokeUsagesBefore = await db.usages.count()
const revokeAdd = db.usages.add.bind(db.usages)
db.usages.add = ((...args: unknown[]) => {
  const entry = args[0] as { kind?: string }
  if (entry?.kind === 'reversal') {
    return Promise.reject(new Error('simulated reversal error'))
  }
  return revokeAdd(...(args as [never]))
}) as typeof db.usages.add
await assert.rejects(() => runStore.revokeRun(runIdB), /simulated reversal error/)
db.usages.add = revokeAdd
assert.equal(await db.runs.count(), revokeRunsBefore)
assert.equal(await db.usages.count(), revokeUsagesBefore, '撤销失败时不允许新增半成品 reversal')
const runBStillActive = await db.runs.get(runIdB)
assert.equal(runBStillActive?.revokedAt, null, '撤销失败批次仍为有效')
const bConsume = await db.usages
  .where('runId').equals(runIdB)
  .filter((u) => u.kind === 'consume').first()
assert.equal(bConsume?.reversedById, undefined, '撤销失败不能标记原流水')
console.log('✔ 阶段 E：撤销失败同样整笔回滚')

db.close()
console.log('\n全部账本行为验证通过。')
