import type { ChemicalUsage } from './chemical-usage'

export type TankType = '双联罐' | '深罐'

export interface DevRun {
  id?: number
  batchNo: string
  recipeId: number
  // 实冲时所用显影液快照：即使日后配方改挂别的工作液，本批次的耗药归属也不变
  developerId: number
  actualTempC: number
  actualMinutes: number
  tankType: TankType
  runDate: string
  result: string
  // 撤销时间；撤销后流水以 reversal 冲销，记录本身保留留痕
  revokedAt?: string | null
  schemaRev?: number
}

// 登记入参：显影液不用调用方指定，store 按配方快照 developerId
export type NewRun = Omit<DevRun, 'id' | 'developerId' | 'revokedAt' | 'schemaRev'>

export interface RunUsagePair {
  run: DevRun
  usage: ChemicalUsage
}
