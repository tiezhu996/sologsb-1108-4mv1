# 胶片冲洗参数库

面向黑白与彩色胶片冲洗者的本地参数管理工具。可以按乳剂批次登记胶片、记录显影液工作液寿命、编排冲洗配方，并把每次实冲温度、时间和样片结果沉淀为下一批次的修正依据。应用为纯前端单页应用，不需要后端服务或外部接口。

## Docker 一键启动

在项目根目录执行：

```bash
cp .env.example .env && docker compose up -d --build
```

停止服务：

```bash
docker compose down
```

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 前端框架 | Vue 3 + TypeScript |
| 构建工具 | Vite 5 |
| UI 组件 | Element Plus |
| 状态管理 | Pinia |
| 路由 | Vue Router 4 |
| 本地数据 | Dexie 4 + IndexedDB |
| 容器 | Nginx Alpine + Docker Compose |

## 访问地址

浏览器打开：`http://localhost:21808`

如修改 `.env` 中的 `FRONTEND_PORT`，请使用修改后的端口。

## 本地开发方式

```bash
cd frontend
npm install
npm run dev
```

开发服务器默认地址为 `http://localhost:5173`。生产构建检查使用：

```bash
cd frontend
npm run build
```

## 目录结构

```text
.
├── docker-compose.yml
├── .env.example
├── README.md
└── frontend
    ├── Dockerfile
    ├── nginx.conf
    └── src
        ├── components/common   # 曲线、稀释、推拉标签与筛选组件
        ├── hooks               # 配方筛选与温度补偿
        ├── pages               # 五个业务页面
        ├── router              # 路由配置
        ├── stores              # 胶片、显影液、配方、冲洗记录与耗药流水的 Pinia 状态
        ├── types               # 胶片、显影液、配方、冲洗记录、耗药流水模型
        └── utils               # Dexie 数据层、比例换算、JSON 导出
```

## 数据存储说明

- IndexedDB 数据库名：`gbfilmdev-db`
- Dexie 版本：
  - `version(1)` 创建 `films`、`developers`、`recipes`、`runs` 四张表并建立常用查询索引。
  - `version(2).upgrade(...)` 为已有记录回填 `schemaRev: 2`。
  - `version(3)` 新增可撤销的**耗药流水账本** `usages`（索引：`developerId / runId / kind / status / consumedAt`），并为 `runs` 增加 `developerId` 索引。升级时自动为每条旧实冲批次补一条 `batch` 流水（同时在批次上锁定显影液快照），旧 `usedRolls` 计数器中无法对应批次的余量补为一条 `opening` 期初流水，保证升级前后用量一致。
- 耗药账本规则：
  - 登记实冲时，批次（含配方与所用显影液快照）与一条 `active` 耗药流水在同一个 Dexie 读写事务内写入；任一步失败整笔回滚，不会留下半条记录。
  - 在冲洗记录页撤销批次时，只把该批次对应的流水置为 `reversed`（保留冲销时间与原因）并删除批次；其他批次流水不受影响，工作液剩余次数由账本汇总自动还原。
  - 显影液页的已用量、可冲余量与报废提示全部以 `active` 流水汇总为准，不再读取旧版 `usedRolls` 计数器。
- 首次打开数据库时通过 `populate` 写入胶片、显影液、配方、实冲记录及配套耗药流水。
- 数据保存在当前浏览器，不随容器重建而丢失；更换浏览器或清理站点数据前，可在顶部导航点击“导出数据”下载 JSON 备份（含耗药流水）。
- 所有新增和更新动作在写入 Dexie 前均会去除响应式代理，避免 `DataCloneError`。
- 账本逻辑可执行 `cd frontend && npm run verify:ledger` 验证（基于 fake-indexeddb，覆盖种子账本、v2→v3 升级补齐、登记/撤销与事务回滚）。

## 核心功能与路由表

| 路由 | 页面标题 | 核心功能 |
| --- | --- | --- |
| `/` | 参数速查台 | 按胶片、稀释比、推拉档检索参数，查看最近冲洗记录 |
| `/films` | 胶片型号与乳剂批次台账 | 登记乳剂批次，按画幅和有效期筛选，观察余量 |
| `/developers` | 显影液配制与余量 | 登记工作液、换算容量、查看剩余可冲卷数并标记报废 |
| `/recipes` | 配方表 | 编排配方，按胶片和稀释比筛选，改温度即时重算时间 |
| `/runs` | 冲洗记录与结果评价 | 录入实冲温度与时间，查看补偿建议并回写配方注释 |

未匹配的路由会重定向到 `/`。
