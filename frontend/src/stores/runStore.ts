import { defineStore } from 'pinia'
import { db, plain } from '../utils/db'
import type { DevRun } from '../types/dev-run'
import type { DeveloperUsage } from '../types/developer-usage'

type NewRun = Omit<DevRun, 'id' | 'schemaRev' | 'developerId'>

export interface RegisterRunResult {
  runId: number
  usageId: number
  developerId: number
}

export const useRunStore = defineStore('run', {
  state: () => ({
    runs: [] as DevRun[],
    loading: false
  }),
  getters: {
    recentRuns: (state) => [...state.runs]
      .sort((a, b) => b.runDate.localeCompare(a.runDate))
      .slice(0, 6)
  },
  actions: {
    async load(): Promise<void> {
      this.loading = true
      try {
        this.runs = await db.runs.orderBy('id').reverse().toArray()
      } finally {
        this.loading = false
      }
    },
    /**
     * 登记实冲：批次（含配方、所用显影液快照）与耗药流水在同一个可序列化事务内写入。
     * 配方或显影液不存在、任一写入失败时，整个事务回滚，不会留下半条记录。
     */
    async addRun(payload: NewRun): Promise<RegisterRunResult> {
      const result = await db.transaction('rw', db.runs, db.recipes, db.developers, db.usages, async () => {
        const recipe = await db.recipes.get(payload.recipeId)
        if (!recipe) {
          throw new Error('所选配方不存在，无法登记冲洗记录')
        }
        const developerId = recipe.developerId
        const developer = await db.developers.get(developerId)
        if (!developer) {
          throw new Error('配方对应的显影液不存在，无法登记冲洗记录')
        }

        const run: DevRun = {
          ...payload,
          developerId,
          schemaRev: 3
        }
        const runId = await db.runs.add(plain(run))
        const usage: DeveloperUsage = {
          developerId,
          runId,
          batchNo: payload.batchNo,
          kind: 'batch',
          rolls: 1,
          consumedAt: payload.runDate,
          status: 'active',
          schemaRev: 3
        }
        const usageId = await db.usages.add(plain(usage))
        return { runId, usageId, developerId }
      })
      await this.load()
      return result
    },
    /**
     * 撤销批次：在一个事务内删除该批次并只冲销它自己的耗药流水。
     * 其他批次的流水与有效用量不受影响，工作液剩余次数由账本汇总自动还原。
     */
    async revokeRun(runId: number): Promise<void> {
      await db.transaction('rw', db.runs, db.usages, async () => {
        const run = await db.runs.get(runId)
        if (!run) {
          throw new Error('要撤销的冲洗批次不存在')
        }
        const today = new Date().toISOString().slice(0, 10)
        const linked = await db.usages.where('runId').equals(runId).toArray()
        await Promise.all(linked
          .filter((usage) => usage.status === 'active')
          .map((usage) => db.usages.update(usage.id as number, plain({
            status: 'reversed',
            reversedAt: today,
            reverseReason: `撤销批次 ${run.batchNo}`
          })))
        )
        await db.runs.delete(runId)
      })
      await this.load()
    },
    async writeBackNote(runId: number, recipeId: number): Promise<void> {
      const run = await db.runs.get(runId)
      if (!run) return
      const note = `${run.runDate} 实冲 ${run.actualTempC}°C / ${run.actualMinutes} 分钟：${run.result}`
      await db.recipes.update(recipeId, plain({ note }))
    }
  }
})
