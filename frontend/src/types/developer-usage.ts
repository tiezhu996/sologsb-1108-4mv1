// 耗药流水类型：每一次显影液消耗都对应一条可冲销的账本记录
export type DeveloperUsageKind = 'batch' | 'opening'
export type DeveloperUsageStatus = 'active' | 'reversed'

export interface DeveloperUsage {
  id?: number
  developerId: number
  // batch 流水关联的实冲批次；opening 期初流水没有关联批次
  runId?: number
  batchNo?: string
  kind: DeveloperUsageKind
  rolls: number
  consumedAt: string
  status: DeveloperUsageStatus
  reversedAt?: string
  reverseReason?: string
  schemaRev?: number
}
