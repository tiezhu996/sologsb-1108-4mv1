import { defineStore } from 'pinia'
import { db, plain } from '../utils/db'
import type { DevRun, NewRun } from '../types/dev-run'
import type { ChemicalUsage } from '../types/chemical-usage'

export class RunRegisterError extends Error {}

export const useRunStore = defineStore('run', {
  state: () => ({
    runs: [] as DevRun[],
    loading: false
  }),
  getters: {
    activeRuns: (state) => state.runs.filter((run) => !run.revokedAt),
    recentRuns(): DevRun[] {
      return [...this.activeRuns]
        .sort((a, b) => b.runDate.localeCompare(a.runDate))
        .slice(0, 6)
    }
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
    // 登记实冲：批次 + 配方 + 显影液快照与耗药流水必须同时落库，
    // 任何一步写不进去，事务整体回滚，不会留下半条记录。
    async addRun(payload: NewRun): Promise<number> {
      const recipe = await db.recipes.get(payload.recipeId)
      if (!recipe) {
        throw new RunRegisterError('所选配方不存在，无法登记实冲')
      }
      const developerId = recipe.developerId
      const developer = await db.developers.get(developerId)
      if (!developer) {
        throw new RunRegisterError('配方所挂的显影液不存在，无法登记耗药流水')
      }

      const next: Omit<DevRun, 'id'> = {
        ...payload,
        developerId,
        revokedAt: null,
        schemaRev: 3
      }
      const runId = await db.transaction('rw', db.runs, db.usages, async () => {
        const newRunId = await db.runs.add(plain(next))
        const entry: Omit<ChemicalUsage, 'id'> = {
          developerId,
          kind: 'consume',
          quantity: 1,
          runId: newRunId,
          recipeId: recipe.id,
          batchNo: next.batchNo,
          createdAt: `${next.runDate}T00:00:00.000Z`,
          schemaRev: 3
        }
        await db.usages.add(plain(entry))
        return newRunId
      })
      await this.load()
      return runId
    },
    // 撤销批次：只追加一条 reversal 冲销原流水并还原余量，其他批次的流水不受影响。
    async revokeRun(runId: number): Promise<void> {
      const run = await db.runs.get(runId)
      if (!run) {
        throw new RunRegisterError('找不到要撤销的冲洗批次')
      }
      if (run.revokedAt) {
        throw new RunRegisterError('该批次已经撤销，不能重复冲销')
      }
      const usage = await db.usages
        .where('runId')
        .equals(runId)
        .filter((item) => item.kind === 'consume' && item.reversedById === undefined)
        .first()
      if (!usage || usage.id === undefined) {
        throw new RunRegisterError('该批次缺少耗药流水，为避免错账已中止撤销')
      }
      const usageId = usage.id

      await db.transaction('rw', db.runs, db.usages, async () => {
        const reversal: Omit<ChemicalUsage, 'id'> = {
          developerId: run.developerId,
          kind: 'reversal',
          quantity: -1,
          runId: run.id,
          recipeId: run.recipeId,
          batchNo: run.batchNo,
          reversesId: usageId,
          createdAt: new Date().toISOString(),
          schemaRev: 3
        }
        const reversalId = await db.usages.add(plain(reversal))
        await db.usages.update(usageId, plain({ reversedById: reversalId }))
        await db.runs.update(runId, plain({ revokedAt: new Date().toISOString() }))
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
