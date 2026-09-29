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
  state: DeveloperState
  schemaRev?: number
}

// 新建工作液时可登记一个期初已冲卷数（会写成 open 流水），之后一律看账本
export type NewDeveloper = Omit<Developer, 'id' | 'schemaRev'> & {
  openingUsed?: number
}
