# Portaldot Hacker House 2026 参赛调研

核对时间：2026-10-22 23:44 America/New_York / 2026-10-23 11:44 Asia/Shanghai。

结论：值得以小规模新项目参与，优先完成 10 月 24 日 Check-in。推荐方向是 Portaldot V3 的 Solidity 迁移验收与回归工具。当前最紧的依赖是报名凭证、测试币发放和首次真实部署，不能把 11 月最终截止当成唯一节点。

本文件是调研与实施建议，项目尚未由本次调研注册、提交、发布或部署；未发送 Discord 消息，也未创建支持工单。账户是否已由用户在其他流程报名，未在本次验证。

## 已核实的信息与来源

| 来源 | 本次读取结果 |
| --- | --- |
| [DoraHacks 官方详情](https://dorahacks.io/hackathon/portaldot-hacker-house-2026/detail) | 通过已打开的 Chrome 页面实时读取；普通网页抓取返回 405，因此未用抓取失败判断赛事状态 |
| [本届公开项目列表](https://dorahacks.io/hackathon/portaldot-hacker-house-2026/build) | 实时显示 12 个公开项目；该数量不能代表全部报名、待审核或有效最终作品 |
| [10 月 21 日官方 Check-in 公告](https://discord.com/channels/1440212664751099996/1506204427651125349/1562526145373544599) | LevelMax 公告：10/24 12:00 UTC 截止；须能演示原型和 Portaldot 集成；提交在 DoraHacks，项目公开需管理员审核 |
| [10 月 16 日官方测试网更新](https://discord.com/channels/1440212664751099996/1506204427651125349/1560719007307403354) | 新 RPC、chain ID、测试币申请方式；旧端点停用 |
| [hack-chat](https://discord.com/channels/1440212664751099996/1497976354157887680) | 10/22 有社区成员回复仍可报名；Titus 要求通过 ticket 申请测试币。社区成员的答复未作为官方豁免或参赛批准 |
| [支持工单入口](https://discord.com/channels/1440212664751099996/1440324575387713588) | 可见 Open Ticket 按钮，未点击创建工单 |
| [官方在 Discord 推荐的 V3 指南](https://github.com/ItsCogumellum/portaldot-v3-testnet-guide) | V3 账户、原生资产、NFT、Solidity 与测试网示例 |
| [V3 FAQ](https://github.com/ItsCogumellum/portaldot-v3-testnet-guide/blob/main/FAQ.md) | 工具链与未确认的兼容性边界 |

Discord 中 read-me、hackathon-rules、问答和 progress-review 可见内容主要属于 2026 年 4—5 月的上一届。上一届的 Rust/ink! 限制、5 月报名期限、纯本地节点和进度频道发帖要求，不能直接套到本届。本届以当前 DoraHacks 规则及 10 月公告为依据。

## 时间与资格门槛

| 节点 | 官方 UTC | 北京时间 | 纽约时间 |
| --- | --- | --- | --- |
| Check-in | 10/24 12:00 | 10/24 20:00 | 10/24 08:00 EDT |
| 反馈公布 | 10/26 16:00 | 10/27 00:00 | 10/26 12:00 EDT |
| Office Hour 申请 | 10/27 12:00 | 10/27 20:00 | 10/27 08:00 EDT |
| 最终提交与代码冻结 | 11/06 04:00 | 11/06 12:00 | 11/05 23:00 EST |

当前官方正文另列 Office Hours 为 10/28—29 UTC、Demo Day 为 11/8—9 UTC；具体场次时间未见明确安排。网上聚合站仍有旧时间，不能据此订日程。纽约在最终截止前已切换冬令时，所以应按上述 EST 换算。

当前页面仍显示 Register / Submit Build。规则支持个人与团队，要求能够独立开发并持续交付 Web3 产品；须实际使用 V3 特点并在 Portaldot 测试网部署。页面未列明单独的已过报名截止，但新报名是否必须通过 Check-in、缺席会否失去最终资格，以及本次账户报名状态，仍需确认。按时交 Check-in 是目前最稳妥的参与路径。

## 必须交付什么

Check-in 需准备：

- 当前进度与待完成项。
- 公开 GitHub 仓库、完整 README、持续开发记录和架构图。
- 测试网集成证据，适用时包含合约地址、交易哈希和浏览器链接。
- 一个可演示的核心流程；在线 Demo 或不超过 3 分钟的视频二选一。
- 初步演示允许模拟数据，但必须披露；官方鼓励真实测试网交互，10 月公告强调应验证 V3 集成。

最终提交还需完整的可运行代码与部署说明、可运行 Demo、不超过 3 分钟的公开视频，以及 PDF 或公开链接形式的 Pitch Deck。Deck 应说明问题、Portaldot 的必要性、已实现功能的证据和后续建设计划。

代码规则包括：主要开发发生于 10/14—11/6，赛事期间仓库公开，至少 3 次有效提交，保留真实开发记录；核心模块最终版本不能集中在最后 24 小时一次提交；最终截止后冻结核心功能和架构。已有完整项目不能直接作为作品提交，第三方依赖可以使用并须注明来源。

评审权重为技术交付 30%、创新 30%、生态贡献 20%、商业潜力 20%。链上证据和公开提交历史直接影响评审，只有漂亮界面不够。

## 奖励与投入判断

总池为 5,200 USDT 等值，其中 2,600 为 USDT、另 2,600 为 POT 等值。总冠军 1,000，各赛道第一 800，DApp 二/三名 500/300，社区奖 200。总冠军和赛道第一不叠加，社区奖可以叠加；赛道奖可能空缺。

后续生态资金、服务器补助、技术协助和推广属于另行申请与里程碑评审，并非报名或获奖即保证发放。不能把 5,200 视为全现金，也不能据公开项目数量推算获奖概率。

## 测试网与资金依赖

- Substrate：`wss://test-node-v3.portaldot.dev`
- EVM：`https://test-evm-rpc-v3.portaldot.dev`
- Chain ID：`420420777`
- Node Console：<https://node-console.portaldot.dev/>

本次已只读验证新 EVM RPC 返回正确 chain ID，并观察块高从 155037 增至 155049。该结果只证明 RPC 可访问且链在出块，未证明我们自己的合约已部署或产品闭环已完成。

测试币通过参赛登记地址或 Discord ticket 申请。工单提供报名/参赛截图及以 `5` 开头的原生 POT SS58 地址，不能用 `0x` EVM 地址代替。详情页还提供未收到测试币时联系 DoraHacks 管理员 Stella707827 或 Discord titus242471 的补发渠道。申请和实际到账是两种状态，发放速度未确认。

本届没有发现必须购买主网 POT 的要求；执行和链上存储使用测试币，可能涉及 storage deposit。V1 可以不依赖付费模型 API。测试币等待时间不能计入可控开发工期。

V3 Solidity 使用 revive；账户映射与 Ethereum 同私钥账户的直觉不能混用。应按官方指南核对 H160/native SS58 映射及实际资助账户。指南提供 MetaMask、Remix、Hardhat 说明；Foundry、跨 VM 同步调用与 iBridge 开放路线/费用尚未确认，不作为第一版依赖。

指南中的 Solidity 示例含映射和签名交易，不能直接当作只读脚本运行。其硬编码示例地址本次返回空代码，不能引用为已经部署成功的产品证据。

## 选题与差异化

当前 12 个公开作品中，NodePulse、PortalPulse、PortalGuard、PortaPulse 已覆盖节点监控；SplitPot 做拆账，Verigate 做 Agent 支付鉴权，PortalProof 做委托交付记录。旧届生态还已有官方推广的 PDK/FailLens 和 ProofPort。因此不建议再做泛化节点看板、支付预检查或通用托管。

推荐暂名 **ReviveCheck**，主报 **Modular Cloud & Middleware**：为将 Solidity 应用迁到 Portaldot V3 的开发者提供可重复执行的部署验收与回归报告。产品核心是 V3 的账户映射、部署配置、真实状态与交易证据核验，不依赖大模型解释错误。

Check-in 的最小闭环：

1. 识别当前网络，显示正确的原生/部署账户映射和测试币状态。
2. 对错误 chain ID、缺失映射或资金不足显示明确失败，避免把不可验证状态当成功。
3. 自己在 V3 测试网部署极小 Solidity Probe 合约，完成一次状态写入和读回。
4. 导出 JSON/HTML 报告，含网络、区块、合约地址、交易哈希、断言与失败原因。
5. 演示一个失败配置，修正后跑通同一验收流程。

决赛扩展方向是合约回归用例、CI 集成、可下载证据包，以及经验证后才加入的原生/EVM 双接口状态一致性断言。不能预先宣称跨 VM 或双接口一致性已经实现。

只做几项 RPC 查询和表单界面，创新性会弱。竞争力应来自可复现的回归用例和确切的失败/成功断言，并找至少一个其他参赛开发者验证使用价值。

备选是原生 NFT 授权检查与撤销工具；需先验证当前 runtime 相关调用，并确认没有自定义合约时，collection/item ID 与 extrinsic 哈希是否满足部署证据要求。它不是当前主推方向。

## 建议执行顺序与投入上限

1. 先完成报名并取得凭证，同时准备隔离的测试账户，申请 tPOT。保留申请状态和到账结果。
2. 新建参赛仓库，形成真实的开发里程碑提交；披露复用依赖。
3. 给首次真实部署设置约 2 小时技术验证窗口。若失败，先解决账户、资金与编译问题，不扩展界面。
4. 预计用 5—7 小时实现核心原型，2—3 小时做 README、架构图和演示。Check-in 阶段整体预算约 8—12 小时，不含测试币等待。
5. 在 10/24 20:00 北京时间前完成 Check-in。若仍未取得测试币或真实部署，诚实标注，并确认主办方是否接受待补证据。
6. 根据 10/26 的反馈决定是否再投入约 20—30 小时准备决赛；在最后 24 小时之前形成核心功能最终版本，留出打包与演示检查时间。

上述工时为规划估算，不是已经完成或保证能完成的时间。

## 待向主办方确认的问题与英文草稿

尚未发送，供后续明确授权时使用：

> Hi team, we’re considering joining the current V3 Hacker House as a new entrant. Can we register now and submit the October 24 check-in? Is passing this check-in required for final eligibility? We plan to build a V3 Solidity deployment and regression tool using account mapping and verifiable testnet calls. Would this fit the Modular Cloud & Middleware track? We will request tPOT through a support ticket with our registration screenshot and native SS58 address. If token distribution is delayed, can the check-in include the working prototype with the outstanding deployment evidence clearly disclosed?

最优先确认的是新参赛者与 Check-in 的资格关系、测试币发放时效，以及该工具赛道适配。Office Hours 与 Demo Day 的具体场次则在公布后再安排。
