// 耗药流水：所有用量变动只追加流水，不直接改写台账数字。
// open      —— 期初值（新建工作液时带入 / 旧数据升级时补齐）
// consume   —— 登记一次实冲，消耗一卷工作液
// reversal  —— 撤销某个批次时，对原 consume 流水的冲销（金额为负，永不删除原流水）
export type ChemicalUsageKind = 'open' | 'consume' | 'reversal'

export interface ChemicalUsage {
  id?: number
  developerId: number
  kind: ChemicalUsageKind
  quantity: number
  runId?: number
  recipeId?: number
  batchNo?: string
  reversesId?: number
  reversedById?: number
  createdAt: string
  schemaRev?: number
}
