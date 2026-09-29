import { defineStore } from 'pinia'
import { db, plain } from '../utils/db'
import type { Developer, NewDeveloper } from '../types/developer'
import type { ChemicalUsage } from '../types/chemical-usage'
import { remainingRolls } from '../utils/ratio'
import { isDeveloperExhausted, usageForDeveloper } from '../utils/ledger'

export const useDeveloperStore = defineStore('developer', {
  state: () => ({
    developers: [] as Developer[],
    usages: [] as ChemicalUsage[],
    loading: false
  }),
  getters: {
    activeDevelopers: (state) => state.developers.filter((developer) => developer.state !== '报废'),
    // 某瓶工作液的累计用量：open 期初 + consume 消耗 - reversal 冲销
    usedByDeveloper: (state) => (developerId: number): number =>
      usageForDeveloper(state.usages, developerId),
    remainingByDeveloper(): (developerId: number) => number {
      return (developerId: number) => {
        const developer = this.developers.find((item) => item.id === developerId)
        if (!developer) return 0
        return remainingRolls(developer.maxRolls, this.usedByDeveloper(developerId))
      }
    },
    availableRolls(): number {
      return this.activeDevelopers.reduce(
        (sum, developer) => sum + remainingRolls(developer.maxRolls, this.usedByDeveloper(developer.id ?? -1)),
        0
      )
    },
    exhaustedCount(): number {
      return this.developers
        .filter((developer) => isDeveloperExhausted(developer, this.usages))
        .length
    }
  },
  actions: {
    async load(): Promise<void> {
      this.loading = true
      try {
        const [developers, usages] = await Promise.all([
          db.developers.orderBy('id').reverse().toArray(),
          db.usages.orderBy('id').toArray()
        ])
        this.developers = developers
        this.usages = usages
      } finally {
        this.loading = false
      }
    },
    async addDeveloper(payload: NewDeveloper): Promise<number> {
      const { openingUsed = 0, ...rest } = payload
      const developer: Omit<Developer, 'id'> = { ...rest, schemaRev: 3 }
      // 工作液与期初流水同进同退：任一条写不进去都不留半条记录
      const id = await db.transaction('rw', db.developers, db.usages, async () => {
        const developerId = await db.developers.add(plain(developer))
        if (openingUsed > 0) {
          const entry: Omit<ChemicalUsage, 'id'> = {
            developerId,
            kind: 'open',
            quantity: openingUsed,
            createdAt: `${developer.mixedAt}T00:00:00.000Z`,
            schemaRev: 3
          }
          await db.usages.add(plain(entry))
        }
        return developerId
      })
      await this.load()
      return id
    },
    async scrap(id: number): Promise<void> {
      await db.developers.update(id, plain({ state: '报废' }))
      await this.load()
    }
  }
})
