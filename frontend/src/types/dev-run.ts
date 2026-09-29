export type TankType = '双联罐' | '深罐'

export interface DevRun {
  id?: number
  batchNo: string
  recipeId: number
  // 登记实冲时锁定的所用显影液快照，与耗药流水在同一事务写入
  developerId?: number
  actualTempC: number
  actualMinutes: number
  tankType: TankType
  runDate: string
  result: string
  schemaRev?: number
}
