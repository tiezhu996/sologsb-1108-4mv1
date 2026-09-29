import { defineStore } from 'pinia'
import { db } from '../utils/db'
import type { DeveloperUsage } from '../types/developer-usage'

export const useUsageStore = defineStore('usage', {
  state: () => ({
    usages: [] as DeveloperUsage[],
    loading: false
  }),
  getters: {
    activeUsages: (state) => state.usages.filter((usage) => usage.status === 'active'),
    /** 某瓶工作液由账本汇总出的有效已冲卷数（已撤销批次的冲销流水不计入） */
    usedRollsFor: (state) => (developerId: number): number =>
      state.usages
        .filter((usage) => usage.status === 'active' && usage.developerId === developerId)
        .reduce((sum, usage) => sum + usage.rolls, 0)
  },
  actions: {
    async load(): Promise<void> {
      this.loading = true
      try {
        this.usages = await db.usages.orderBy('id').toArray()
      } finally {
        this.loading = false
      }
    }
  }
})
