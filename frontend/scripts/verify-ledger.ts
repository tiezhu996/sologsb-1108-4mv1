import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { db } from '../src/utils/db'

async function freshDb() {
  await db.open()
  return db
}

async function countsByDeveloper() {
  const usages = await db.usages.toArray()
  const map = new Map<number, number>()
  usages
    .filter((u) => u.status === 'active')
    .forEach((u) => map.set(u.developerId, (map.get(u.developerId) ?? 0) + u.rolls))
  return map
}

async function testPopulateSeeds() {
  await freshDb()
  const runs = await db.runs.count()
  const usages = await db.usages.toArray()
  assert.equal(runs, 7, 'should seed 7 runs')
  const batch = usages.filter((u) => u.kind === 'batch')
  assert.equal(batch.length, 7, 'each seeded run gets a batch usage')
  assert.ok(usages.every((u) => u.status === 'active'))
  // 显影液快照写入批次
  const run1 = await db.runs.get(1)
  assert.equal(run1?.developerId, 1)
  const counts = await countsByDeveloper()
  // dev1: 3 批次 + 1 期初 = 旧计数 4；dev2: 1 + 7 期初 = 8；dev3: 2 + 8 = 10；dev5: 0 + 10
  assert.deepEqual(Object.fromEntries(counts), { 1: 4, 2: 8, 3: 10, 4: 1, 5: 10 })
  const openings = usages.filter((u) => u.kind === 'opening')
  assert.deepEqual(openings.map((u) => u.rolls).sort((a, b) => a - b), [1, 7, 8, 10])
  console.log('✓ populate: 批次快照 + 流水 + 期初补齐正确')
}

async function testRegisterAndRevoke() {
  // 追加一批次：dev1 用量 4 -> 5
  const runId = await db.runs.add({
    batchNo: 'R-260929-08', recipeId: 1, developerId: 1,
    actualTempC: 20, actualMinutes: 9, tankType: '双联罐', runDate: '2026-09-29',
    result: '测试批次', schemaRev: 3
  })
  await db.usages.add({
    developerId: 1, runId, batchNo: 'R-260929-08', kind: 'batch', rolls: 1,
    consumedAt: '2026-09-29', status: 'active', schemaRev: 3
  })
  let counts = await countsByDeveloper()
  assert.equal(counts.get(1), 5)

  // 另一批次 dev1 用量到 6
  const otherId = await db.runs.add({
    batchNo: 'R-260929-09', recipeId: 1, developerId: 1,
    actualTempC: 20, actualMinutes: 9, tankType: '双联罐', runDate: '2026-09-29',
    result: '另一批次', schemaRev: 3
  })
  await db.usages.add({
    developerId: 1, runId: otherId, batchNo: 'R-260929-09', kind: 'batch', rolls: 1,
    consumedAt: '2026-09-29', status: 'active', schemaRev: 3
  })
  counts = await countsByDeveloper()
  assert.equal(counts.get(1), 6)

  // 模拟撤销：只冲销 runId 对应流水、删批次
  await db.transaction('rw', db.runs, db.usages, async () => {
    await db.usages.where('runId').equals(runId).modify({ status: 'reversed', reversedAt: '2026-09-29' })
    await db.runs.delete(runId)
  })
  counts = await countsByDeveloper()
  assert.equal(counts.get(1), 5, 'revoking one batch restores exactly one roll')
  const revoked = await db.usages.where('runId').equals(runId).first()
  assert.equal(revoked?.status, 'reversed')
  const other = await db.usages.where('runId').equals(otherId).first()
  assert.equal(other?.status, 'active', 'later batch untouched')
  const remainingRuns = await db.runs.count()
  assert.equal(remainingRuns, 8)
  console.log('✓ revoke: 只冲销对应流水，余量还原，其他批次不受影响')
}

async function testAtomicRollback() {
  const beforeRuns = await db.runs.count()
  const beforeUsages = await db.usages.count()
  // 事务内第二批写入（usages.add 重复主键）失败，整体回滚
  let threw = false
  try {
    await db.transaction('rw', db.runs, db.usages, async () => {
      const newRunId = await db.runs.add({
        batchNo: 'BROKEN', recipeId: 1, developerId: 1,
        actualTempC: 20, actualMinutes: 9, tankType: '双联罐', runDate: '2026-09-29',
        result: '应回滚', schemaRev: 3
      })
      // 故意制造失败：runId 唯一索引上的重复值
      await db.usages.add({
        id: 1,
        developerId: 1, runId: newRunId, batchNo: 'BROKEN', kind: 'batch', rolls: 1,
        consumedAt: '2026-09-29', status: 'active', schemaRev: 3
      })
    })
  } catch {
    threw = true
  }
  assert.ok(threw, 'transaction must reject')
  assert.equal(await db.runs.count(), beforeRuns, 'no half run left')
  assert.equal(await db.usages.count(), beforeUsages, 'no half usage left')
  assert.equal(await db.runs.filter((run) => run.batchNo === 'BROKEN').first(), undefined)
  console.log('✓ atomic: 任一步失败，整笔登记不留半条记录')
}

async function main() {
  await testPopulateSeeds()
  await testRegisterAndRevoke()
  await testAtomicRollback()
  console.log('\nALL DB TESTS PASSED')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
}).finally(() => {
  db.close()
})
