export type DeveloperCategory = 'D-76' | 'HC-110' | 'Rodinal' | 'C-41'
export type Dilution = '1:1' | '1:3'
export type DeveloperState = '新配' | '在用' | '报废'

export interface Developer {
  id?: number
  name: string
  category: DeveloperCategory
  dilution: Dilution
  volumeMl: number
  mixedAt: string
  maxRolls: number
  /**
   * @deprecated 旧版手写计数器，自 schemaRev 3 起仅用于升级补齐流水，
   * 页面用量与余量一律以 usages 账本汇总为准。
   */
  usedRolls?: number
  state: DeveloperState
  schemaRev?: number
}
