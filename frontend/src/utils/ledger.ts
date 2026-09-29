import type { ChemicalUsage } from '../types/chemical-usage'
import type { Developer } from '../types/developer'
import { remainingRolls } from './ratio'

// 账本汇总：页面上的用量、可冲余量、报废判断都只认流水，不再信任手工计数。
export function usageForDeveloper(usages: ChemicalUsage[], developerId: number): number {
  return usages
    .filter((item) => item.developerId === developerId)
    .reduce((sum, item) => sum + item.quantity, 0)
}

// 有效（未被冲销）的消耗流水数；reversal 与被冲销的 consume 净额相抵
export function activeConsumeCount(usages: ChemicalUsage[], developerId?: number): number {
  return usages
    .filter((item) => (developerId === undefined || item.developerId === developerId))
    .filter((item) => item.kind === 'consume' && item.reversedById === undefined)
    .length
}

export function developerRemaining(developer: Developer, usages: ChemicalUsage[]): number {
  return remainingRolls(developer.maxRolls, usageForDeveloper(usages, developer.id ?? -1))
}

// 报废判断：手工标记报废，或账本汇总显示余量已耗尽（含超用）
export function isDeveloperExhausted(developer: Developer, usages: ChemicalUsage[]): boolean {
  return developer.state === '报废'
    || usageForDeveloper(usages, developer.id ?? -1) >= developer.maxRolls
}
