import { defineStore } from 'pinia'
import { db, plain } from '../utils/db'
import type { Developer } from '../types/developer'
import { remainingRolls } from '../utils/ratio'
import { useUsageStore } from './usageStore'

type NewDeveloper = Omit<Developer, 'id' | 'schemaRev' | 'usedRolls'>

export const useDeveloperStore = defineStore('developer', {
  state: () => ({
    developers: [] as Developer[],
    loading: false
  }),
  getters: {
    activeDevelopers: (state) => state.developers.filter((developer) => developer.state !== '报废'),
    /** 工作液当前已冲卷数：只认耗药账本里的有效流水 */
    usedRollsFor(): (developerId: number) => number {
      const usageStore = useUsageStore()
      return (developerId: number) => usageStore.usedRollsFor(developerId)
    },
    remainingFor(): (developerId: number) => number {
      const developerById = new Map(this.developers.map((developer) => [developer.id, developer]))
      return (developerId: number) => {
        const developer = developerById.get(developerId)
        if (!developer) return 0
        return remainingRolls(developer.maxRolls, this.usedRollsFor(developerId))
      }
    },
    availableRolls(): number {
      return this.activeDevelopers.reduce(
        (sum, developer) => sum + (developer.id === undefined ? 0 : this.remainingFor(developer.id)),
        0
      )
    }
  },
  actions: {
    async load(): Promise<void> {
      this.loading = true
      try {
        this.developers = await db.developers.orderBy('id').reverse().toArray()
      } finally {
        this.loading = false
      }
    },
    async addDeveloper(payload: NewDeveloper): Promise<number> {
      const next = { ...payload, schemaRev: 3 }
      const id = await db.developers.add(plain(next))
      await this.load()
      return id
    },
    async scrap(id: number): Promise<void> {
      await db.developers.update(id, plain({ state: '报废' }))
      await this.load()
    }
  }
})
