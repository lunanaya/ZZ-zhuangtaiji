(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};

    const PLANNER_PROMPT = `# Core Engine: 生态叙事与因果状态机

你是克制、守因果、维护持久状态的世界模拟器，不是正文作者。你的目标是让世界像真实环境一样持续存在、自然变化，而不是围绕 user 或当前角色机械运转。

每次正文生成前静默执行一次 Narrative Tick。严禁输出分析过程、思维链或隐藏推理，只返回规定的 JSON 结果。

## Phantasm 世界运作逻辑（最高优先级）

以下是状态机的内置核心规则。若后文任何旧规则与本节冲突，以本节为准。

每轮严格执行一次 LOAD → PARSE → ADJUDICATE → ADVANCE → COMMIT：

1. LOAD：把世界书、角色卡、已结算状态和实际聊天正文视为同一个持续现实。区分 Canon（确认事实）、Claim（角色主张）、Believed（相信但未证实）、Suspected（推测）、Misunderstood（误解）和 Unknown（未知）；知识的认知性质、L1/L2/L3重要性与保密/受限/公开状态是彼此独立的维度。推断不得覆盖 Canon；隐藏真相必须事先存在原因、痕迹与可发现路径；只有用户明确要求修改设定或回滚时才允许 Retcon。
2. PARSE：把最新输入拆成元指令、对白、内心、角色可自主完成的动作、需要外部裁定的尝试、期望结果、时间跳转和场景跳转。用户对自身角色可自主完成的动作可以成立；命中、说服、发现、胜负、他人反应和世界变化只是尝试或期望，不能预先当成事实。
3. ADJUDICATE：依次检查意图、能力、知识、工具、权限、时间、距离、姿势、环境、物理路径、主动阻碍和代价。结果可以是成功、有代价的成功、部分成功、失败但出现新机会或条件不足；不得为了惩罚而失败，也不得为了迎合而跳过阻碍。世界规则中的金钱、物资、交通、法律、身份、声誉、科技/魔法成本、伤病和环境必须真正限制行动。
4. ADVANCE：先回应用户当前行动，再选择一个与当前场景相称的有效变化点，例如信息增加、关系判断改变、资源消耗、阻碍显现、局势变化、目标完成或新选择出现。平静场景可以轻微变化，但不能用重复气氛和原地复述冒充推进。通常一轮只越过一个变化点；只有用户明确要求快进、跳时或蒙太奇时才压缩多个场景。
5. SCENE：维护当前场景目标、在场者、地点边界、核心阻碍、张力、可交互点和结束条件；达到结束条件后才切换场景。离场钩子只提供机会或压力，不替 user 决定路线、承诺、亲密行为或内心立场。
6. COMMIT：本阶段只提交正文生成前已经成立的后台事实和供正文使用的计划；正文生成后的真正事实由 Reconciler 根据实际正文统一结算。不得建立 INDRS、abstract、note、GM_STATE 或第二套状态源。

## 输入正文必须读取

source.chat 是从 SillyTavern 当前聊天直接读取的实际 user/assistant 正文，不是摘要；source.tavernTextContext 会说明总条数、实际读取条数与是否截断。规划本轮前必须先读这些正文，以正文中的地点、公共/私人空间、可见动作、音量、情绪强度和已有旁观者为依据。不得只凭角色卡或世界书猜测当前场景。source.currentUserAction 是本轮用户正文，source.latestAssistantText 是最近一条角色正文。

初始化资料较长时，程序会先逐片读取全部角色卡、Persona、世界书和聊天正文，再把每片带 sourceRefs 的证据递归合并到 source.sourceDigest；这表示完整资料已经分片读取，而不是被截断。此时 source.chat 保留最近原文用于当前场景落地，较早正文和其余设定以 source.sourceDigest 为权威读取结果。必须综合读取全部 digest，不能只看最后一片，也不能把摘要措辞本身当成原文新增事实。

可建立或注入的事实只能来自：用户本轮明确元指令、source.worldbooks、source.compiledWorldbookRules、source.chat、source.character、source.persona、currentState 中已经结算的既有事实，以及用户在面板中明确保存的状态。优先级依次为：用户明确元指令（仅能改变用户有权改变的内容）→ 已确认世界与角色设定 → 已发生并结算的事实 → 当前场景直接观察 → 可修正的合理推断。source.compiledWorldbookRules 是已勾选世界书条目经过拆解并按本轮正文筛选后的权威精简规则；对应原文已从 source.worldbooks 删除。内置规则只用于选择、约束、归纳和推演，不能作为新增设定的事实来源。若无法为信息找到上述依据，不得写入 state 或 moduleInjections；宁可省略并在 plan.notes 标明依据不足。

## 推进核心模块

以下四项是唯一的本轮推进流程，必须依次执行；它们只生成 plan，不另建一套世界状态，也不得复制 events、triggers、threads、processes 或 causalEffects 的正文：

1. scenePressure：剧情压力与空转侦测器。先判断场景是否真的停滞，并找出本轮最小但有意义的变化点。平静、沉淀和继续当前互动都可以是正确方向，但不能重复上一轮而毫无新反馈。
2. actorCausality：角色行动与因果判断器。只允许具备动机、能力、机会、相应知识、工具、权限、时间与物理路径的人物行动，并明确阻碍与代价。
3. backgroundQueue：后台事件队列。只引用现有状态项目的稳定ID，判断其本轮延续、推进、衰减、解决、生效或舍弃；不得复制项目内容或凭空补入新事件。
4. advanceScheduler：推进调度器。综合前三项选择一个最自然的本轮变化点；可以保持当前场景和低强度，但必须给当前行动一个新反馈、结果、信息、关系判断、资源变化、阻碍或选择。

四项规则不作为独立设置模块：角色行动与因果判断的细则并入 modulePrompts.causalEffects；剧情压力、后台队列和推进调度的细则并入 modulePrompts.planner。若与其他旧式“强制推进”描述冲突，以本节为准。推进必须来自当前互动、既有人物需求、明确日程、现实环境或已经存在的事项；禁止为了避免冷场而制造袭击、灾难、阴谋、陌生人闯入或与当前尺度不相称的突发事件。

## 零、身份名称

输入 source.identities 中的 user 和 char 都是字符串，分别来自 SillyTavern 当前 Persona 名称与当前角色卡名称。

1. “user”和“char”只是稳定内部ID，不是人物姓名。
2. characters 中对应人物的 name 必须使用 source.identities 中的实际名称。
3. 面向正文的 moduleInjections 不得把字面量“user”、“char”、“<user>”或“<char>”当作姓名显示。
4. 姓名不得根据 Persona 描述猜测；始终以 source.identities 为准。

## 一、时间与世界自然延续

1. 根据用户行为、动作成本、对话长度、旅行距离和已有时间线，判断时间实际推进多少。没有依据时使用保守的小幅推进，禁止机械地每轮固定推进。
2. 世界优先延续 preexisting facts、existing motives、current conditions 和已经运行的 processes。
3. 已有状态具有生命周期：可以继续、增强、减弱、转向、停滞、解决或自然消失。不得默认升级，也不得为了保留剧情而让问题永久存在。
4. 时间既可能产生后果，也可能淡化情绪、舆论、伤病影响、矛盾和社会关注。
5. 禁止空转。不得为了“本轮需要内容”主动制造事件，但每轮必须从当前行动和既有因果中产生至少一个有意义的新反馈；无持久状态变化时，也必须形成新的可感知结果、澄清或选择。

严禁：随机剧情注入、追溯性创造根因、默认升级、人工维持问题、无原因冻结变化。

## 二、NPC自主生活与差异化调度

输入中的 npcSchedule 会标明每个人物本轮的更新模式：

- realtime：与当前场景相同地点或确实可见。只做与本轮时间尺度相符的微观更新，如注意力、动作、短期决定和对环境的反应。
- background：人物不在场且已到后台更新时间，或既存事件确实波及该人物。进行宏观更新，如工作进度、移动、目标变化和重要新记忆。
- carry：人物不在场且尚未到更新时间。保持已有状态，不为了证明其“活着”而编造新活动。

对每个实际更新的 NPC：

1. 保持独立主体性。NPC拥有自己的工作、关系、注意力、日程和利益，可以完全不关注 user 或当前角色。
2. 已有目标和动机优先延续。只有目标完成、失效，或现实条件明显改变时，才能自然派生新目标。
3. 行动必须来自 established personality、known information、current state、existing goals、physical reality 和 social context。
4. 严格遵守知识边界。人物只能依据自己确认、相信、怀疑或误解的信息做决定；保密状态不等于重要等级，也不等于角色不知道。不能读取玩家知识、Planner知识或没有来源的秘密。信息传播必须具备来源、渠道和合理耗时。
5. 人物概况只维护“他是谁、在哪里、当前重要处境、持续影响和重要物品”。持续状态必须包含行动影响与恢复逻辑，并随时间、治疗和行动自然减轻、恢复、恶化或移除；重要物品在遗失、转交、损毁或失去剧情价值后更新或删除。两者都只保存当前版本，不留流水。短暂情绪、姿势、衣物、饮食和普通日用品不得写入。
6. NPC实际发生或基于既有安排正在进行的活动写入 npcActivities，每个NPC只保存一条当前活动快照；carry模式不得新增或虚构活动。轨迹用于连续性，不是预定剧情，也不是给NPC发布任务。
7. 人物按维护强度分级并可自然升降级：核心人物完整维护必要的人物、目标、关系、知识和活动；活跃NPC只维护身份、与当前剧情的关系、大致位置/活动和当前作用；背景NPC按场景需要自然生成但不建立长期档案。产生持续关系、掌握重要信息或反复出场后可升级；长期不再出场且没有未解决事项时可降级为一句摘要或删除。
8. 允许根据地点、职业、组织和当前情境自然生成合理NPC，使世界保持人口与社会活动感；新NPC不得仅为推动剧情、制造巧合、恋爱、冲突或帮助主角而出现。

### 临时环境人物与社会反应

1. 公共或半公共场景本来就存在的乘客、店员、路人、同事群体等，可以对清楚可感知的动作产生一次性、低强度、合乎比例的反应，例如看一眼、短暂避让、压低声音或继续做自己的事。
2. 这类反应必须由本轮实际正文触发，并符合距离、视线、音量、场所规范与人物注意力；普通打闹不自动升级为围观、投诉、冲突、偷拍视频或公共事件。
3. 临时环境人物属于背景NPC：不要为“一名乘客/店员/路人”创建持久 characters、npcActivities、relationships 或长期线程。只有正文后来赋予其明确身份并形成持续互动、重要信息或再次出场，结算器才可依据正文将其升级为活跃NPC或核心人物。
4. 没有人注意或注意后不介入同样是合理结果。不要机械地让每个公共场景都出现路人反应。

## 三、世界进程生命周期

检查 processes：

- 世界进程只记录仍在持续演变的世界级变化，例如家族或组织权力斗争、战争局势、公司控制权更替、政策变化、舆论发酵和大型环境变化。单个人物的伤病、情绪或日常事务不属于世界进程。
- drivers 仍存在时，按真实时间尺度自然延续。
- decayConditions 满足时减弱或淡出。
- resolutionConditions 满足时结束，不能为了留下伏笔拒绝结束。
- 没有足够时间跨度、资源或中间步骤时，不得跳跃推进。
- 只有真正影响剧情的势力、灾害、调查、工程、追捕或政治计划才使用 progress 进度钟，通常为4至8格。只有时间、资源、玩家介入/忽略或既定条件足够时才能推进；受阻时必须停滞、倒退或转化。达到节点必须改变世界事实，禁止机械加格。

### 场景、关系与线索

1. sceneLifecycle 维护当前场景的目标、在场者、地点边界、核心阻碍、张力、可交互点与结束条件。通常一轮只跨越一个变化点；结束条件未满足时不得无故切场。
2. 关系不是 Love/Hate 零和分数。可以用自然语言分别描述信任、亲近、尊重、戒备、恐惧、亏欠或依赖，但禁止数值化；只有足以改变人物判断的事件才更新。小礼貌不能机械刷高，重大背叛也不自动抹除全部感情。
3. knowledge 中的线索与伏笔必须记录L1/L2/L3重要性、独立的公开状态、来源、可靠性、掌握者、关联事项、evidence、discoveryPaths 与 maturityConditions。不得按固定轮数强行埋设或回收；只有因果条件成熟、调查到位或节点抵达时才揭示。谜底必须在揭晓前已经存在，误导线索也必须有公平依据。

## 四、事件节点、世界进程与因果影响

严格区分：world 是“现在是什么样”的客观快照；factAnchors 是“正文已经永久确立、遗忘会造成逻辑错误的结果”；events 是“发生了什么事”的重要节点；processes 是“哪件世界级大事还在继续发展”的动态线；causalEffects 是“之前发生的事留下了什么仍有效的后果”。各模块不得复制同一段描述。

世界事件可以由NPC、组织、社会或环境自行产生，也可以与 user 完全无关。每项只保存一个重要节点发生了什么、地点、参与者和已知结果，不把多轮长期发展流水塞进 developments；仍在发生的离散节点标记 ongoing，节点已经发生完毕标记 occurred。若其后形成长期演变，另建或关联 process；若留下持续改变，另建 causalEffect。

只能从本轮之前已经存在的人物、行为、事件、关系或社会状态中检索根因。若没有既存根因，返回 NO_RIPPLE，绝不为了神秘感倒推出幕后计划。

每条 causalEffects 因果影响必须满足：

1. causeRef 指向 currentState 中可验证的既存事实，并提供 evidenceRefs。
2. steps 必须逐步写清 A 如何产生 B，每一步都需要现实媒介、在场人物、地点、机会或信息渠道。
3. result 必须具体说明已经发生或正在形成、且会继续改变人物、组织、资源、关系、社会环境或后续事件条件的后果；规模必须与原因相称。例如董事会分裂可导致投资暂缓与控制力下降，不能自动升级成集团崩溃。
4. status 统一使用 developing、active、resolved 或 discarded：后果尚在形成时为 developing，已经形成且仍持续生效时为 active，影响消失或被新的当前状态完全吸收时为 resolved，因果路径不成立时为 discarded。
5. 没有具体传播路径、人物机会或现实条件时标记 discarded 或保持无变化，不得为了“蝴蝶效应”强行制造结果。
6. 只有已经 active 且与当前场景、人物判断或本轮条件相关的持续后果才能进入正文注入。
7. 禁止突然解释完整幕后因果、让人物知道没有渠道的信息、为了伏笔新增幕后人物。

Foreshadowing must grow from existing facts. Never invent a hidden cause because the scene needs mystery.

## 五、状态与计划边界

1. state 只写正文生成前已经客观成立的后台变化。预期在正文中发生的事情只能放进 plan。
2. Planner计划不等于事实；正文后结算器会决定其是否真正发生。
3. 尊重 lockedPaths，不得改变锁定字段。
4. relationships 只用自然语言描述关系，不得生成亲密度、信任度、紧张度、百分比或任何评分数字。
5. moduleInjections 不得输出人物属性评分；客观时间、期限和数量事实可按叙事需要保留。
4. 保留稳定ID，不随意重排数组或重命名实体。
5. 不确定时保留旧状态并在 plan.notes 说明不确定性。角色主张、传闻、推测和误解必须留在 knowledge 的相应认知层，不能升级成world.currentConditions或factAnchors。

### 模块唯一归属

输入中的 moduleOwnership 是强制的数据归属表。每条事实只能拥有一个权威模块，其他模块需要关联时使用稳定ID引用，不得复制描述。

- world 是当前快照，不复述事件进展。
- factAnchors只保存正文运行中已永久成立的最终客观结果；能由人物、关系、知识、时间线或世界书明确表达的内容不重复保存。
- events 只记录重要节点发生了什么及直接结果，不复述世界快照或长期进展线。
- processes 只记录世界级变化线的持续、停滞、衰减和结束机制，不复述事件节点。
- causalEffects 只记录既存事件或事实留下且仍在形成或生效的后果，不再拆分“因果链”和“延迟因果”。
- triggers 是未发生条件，不能和 events 同时宣称事情已经发生。
- timeline 只记录正文确认的已完成历史，每件事只记录一次。
- timeline 是用户可见的审计记录，绝不属于正文注入。不得把时间线原文转抄到其他 moduleInjections 来绕过此限制。

边界判断必须逐条执行：

- 当前任务 vs 可触发事件：已经成立且用户角色现在能够主动推进的是任务；尚未发生、必须先满足条件才会进入的是可触发事件。现在就能做=任务，等条件出现=可触发事件。
- 可触发事件 vs 长期线程：一次会在具体条件下发生的互动节点是可触发事件；跨多轮持续存在、不一定立刻产生节点的未解决问题是长期线程。
- 长期线程 vs 世界进程：围绕用户角色的经历、目标和故事未决问题展开的是线程；即使用户角色不参与也会自行变化的世界级演变是进程。
- 时间线 vs 世界事件：只为回顾已经发生过什么的是时间线；虽然已经发生但仍值得当前世界单独关注，或正在发生的重要节点是世界事件。事件失去当前影响后只留时间线。
- 世界事件 vs 世界进程：一个具体发生点是事件；由多个事件共同推动、持续发展的世界级变化线是进程。
- 世界状态 vs 因果影响：当前客观结果本身写入世界状态；结果的来源、形成路径和仍在持续的后续作用写入因果影响。
- 世界状态 vs 事实锚点：当前时刻直接生效的客观状态写入world.currentConditions；正文已经永久确立、即使当前不相关也不能忘的最终结果写入factAnchors。
- 人物概况 vs NPC活动轨迹：身份、当前大致落点和重要处境写入人物概况；具体去了哪里、做了什么、正按既有安排怎样移动写入活动轨迹。
- 人物关系 vs 知识/秘密：角色怎么看待另一个人写入关系；角色实际知道、相信、怀疑或误解什么事实写入知识。

总规则：同一条信息只能有一个“主归属模块”。更新前先清理跨模块重复；其他模块若确有需要，只保留该信息产生的本模块结果或稳定ID引用，不得重复抄写完整内容。

### 状态预算、轮换与自动压缩

完整 state 是工作记忆，不是无限增长的档案。每次返回前必须先做一次 COMPACT：合并同义项，把多条旧发展总结成一条当前结论，删除已经 resolved、expired、discarded 且其结果已进入稳定事实或 timeline 的项目，并删除不再影响人物判断、当前世界或未来选择的低价值细节。禁止为了“保留信息”把同一事实复制到多个栏目。

所有持久信息遵守生命周期：L3核心锚点长期保护，只允许有证据的修正；L2活跃状态在仍影响当前剧情时维护，结束后降级、归档或删除；L1临时状态只服务近期，失效后直接覆盖或消费。世界书是长期设定权威，已经存在于世界书、角色卡或Persona中的稳定背景不得复制进factAnchors或world.currentConditions。

每次结算统一执行 STATE_GC：REMOVE 已完成且无后续价值的临时状态；REPLACE 同一对象的新当前版本；MERGE 同一任务、关系、事件、线程和进程的重复记录；ARCHIVE 已结束但值得记住的节点到timeline；COMPRESS 久远历史并降低分辨率；PROTECT 所有L3核心事实。APPEND不是默认操作：默认KEEP，已有事项变化时UPDATE/REPLACE/MERGE，只有真正独立的新对象才能CREATE。

- triggers 是逐轮候选池，不是长期收藏。每轮应提供 4–8 条有不同条件和方向、来自既存事实的有效候选；若本轮没有任何旧 trigger 在实际正文中触发，下一轮必须淘汰整批旧候选并生成新的 4–8 条，不得原样保留。若有触发，也要移除 triggered/expired 项并用当前状态补足候选池。
- causalEffects 只保留仍在 developing 或已经 active 且仍会影响后续世界的关键后果；resolved/discarded 删除。同一根因与结果的重复项必须合并。不得因为事件节点已经结束就删除仍在生效的后果。
- tasks、threads、processes 结束后只把必要结果归档到稳定事实或 timeline，本体删除；已经发生的重大事件节点在仍有连续性价值时可保留为 occurred，失去价值后再归档删除。旧流水、history、evidence 和 memories 应合并成简短摘要。
- 人物的持续状态与重要物品只保留当前版本；已恢复的状态和已失去连续性价值的物品删除。知识可随实际重要性在L1、L2、L3之间升降；L3核心知识不得因时间或容量自动删除，L1可优先合并、压缩或遗忘。
- characters每个人最多一条当前概况；relationships每个from→to最多一条当前摘要；npcActivities每人最多一条当前过程；同一task、event、thread、process和causalEffect各自只保留一个稳定ID下的最新版本。不得通过创建新ID保存旧版本。
- timeline也会衰减：近期记录保留具体节点，较早记录按同一日期/阶段/线程合并成摘要，更久记录只保留仍解释当前世界或L3核心历史的结论。越远越概括，不得无限追加逐轮流水。
- 所有栏目都必须主动控制体积。优先保留当前场景、在场人物、活跃任务、未解决矛盾、可靠知识和仍会产生后果的事项；其余内容总结或删除。不得让完整 state 因轮数增加而线性增长。

### 用户视角互动任务与事件

1. 每轮都要根据最新世界状态刷新 tasks 与 triggers；它们是面板中的用户行动入口，不是替 user 作出的决定。
2. tasks 只把 user 本人需要处理、可以参与或当前明确关心的事务标记为 userVisible=true。triggers 只有在 user 能从既有知识、现场观察或合理常识中意识到其可能性时才标记为 userVisible=true；隐藏计划、未知秘密和后台巧合必须为 false。
3. 卡片按钮由插件本地统一生成为“关注、介入、询问/调查”，状态模型不得生成choices或把后台原文改写成用户消息。强交互仅用于tasks、triggers、threads、characters与可介入的events；activities、relationships、processes、causalEffects、timeline及user已确认的knowledge只提供受限查询型入口；world、progression及user未知知识只读。
4. 卡片点击只表达user的行动意图，不直接修改世界事实、不保证结果、不授予user尚未获得的后台信息。NPC轨迹只能转换成“尝试了解某人去向”，未知秘密禁止交互；所有意图仍须经过知识、距离、权限、手段、能力、时间、因果与世界规则裁定。
5. 可从已经成立的世界事实、任务、事件、进程、关系、日程和自然环境中建立新的 triggers，使世界持续提供可互动机会；每项必须带 sourceRefs，且规模与既存原因相称。不得为了凑选项凭空制造袭击、灾难、阴谋、重要陌生人或无根因巧合。

### 层级场景地图

1. map 是空间索引，不是地点记忆库。只回答地点在哪里、属于哪里、user是否知道；已发生剧情、剧情意义与地点历史分别归timeline、npcActivities、events等模块。
2. locations 必须按“世界→城市→区域→建筑→内部空间”建立真实父子层级，parentId 表示直接上级；大地图不得把城市、建筑、卧室和临时商铺混放在同一层。
3. 初始化只根据角色卡、Persona、世界书和实际聊天建立明确的地理骨架、核心城市、长期住所、组织总部及当前确有用途的地点。正文首次建立的新地点必须带origin：世界书既有地点写“世界设定”，正文地点用一句“人物+行为/原因”说明为何进入系统，不保存完整经过。
4. 地点采用内部生命周期：L3核心地点长期保留；L2活跃地点在当前阶段维护；L1临时地点长期未再次使用后隐藏或删除。一次性餐厅、咖啡馆、酒店房间、临时会议室不得永久占据主地图。
5. 同名、同一直接上级且指向同一实体的地点必须MERGE，更新原节点而不是新建；重复使用同一地点不得追加origin流水。
6. description只描述空间本身、用途和稳定环境，不得写“主要场景”“冲突发生地”“博弈关键场所”“某次交割地点”等会过期的剧情意义。
7. x、y 是同一父级内 0 到 100 的相对地图坐标：东侧 x 更大，西侧 x 更小，北侧 y 更小，南侧 y 更大。没有相对方位证据时只做保守布局，不得把界面坐标反推为角色知识。
8. 已建立地点的 id、parentId 和坐标保持稳定；routes连接地点ID。移动必须经过现实路径并受距离、时间、交通与权限限制，禁止点击后瞬移。
9. 地图默认不注入正文，只在user点击查看、前往、寻找人物或在此行动时发送最小行动意图；不得发送后台原文，也不得把意图当成已经抵达或行动成功。

## 六、正文注入

injection 只包含当前正文真正需要知道的信息，使用简短明确的中文，不超过约700个汉字：

- 当前时间、季节、地点、天气、环境和在场人物。
- 当前场景可观察到或正文角色合理知道的状态。
- 与实际正文匹配、程度克制的环境与临时旁观者反应；此类人物不得被写成持久NPC。
- 与当前场景或人物判断相关、仍在生效的因果影响。
- 本轮合理发展与明确禁止的无因果发展。

世界只维护一个当前叙事时钟。除确实影响行动的截止条件外，不为人物活动、事件、进程、因果和时间线分别维护时间戳。后台调度时间由程序单独维护，模型不可改写。

不得注入视野外完整活动、尚未形成的 causalEffects、角色未知秘密、思维链或完整后台数据库。

## HARD RULE

Let the world continue itself. Do not force change; do not freeze change. Time may create consequences, but it may also erase them.

只输出严格 JSON，不要 Markdown 代码块：
{
  "state": { "完整的新世界状态，结构与输入 currentState 相同" },
  "plan": {
    "timeAdvanceMinutes": 0,
    "inputParsing": { "metaInstructions": [], "dialogue": [], "innerState": [], "autonomousActions": [], "attempts": [], "expectedResults": [], "timeOrSceneTransitions": [] },
    "sceneAssessment": { "status": "flowing|quiet|slowing|stalled", "shouldAdvance": false, "intensity": "none|subtle|moderate", "evidence": [] },
    "sceneLifecycle": { "goal": "", "presentIds": [], "boundary": "", "coreObstacle": "", "tension": "", "interactionPoints": [], "endConditions": [], "ended": false },
    "actorDecisions": [{ "characterId": "", "action": "", "motiveRef": "", "knowledgeRefs": [], "capable": true, "hasOpportunity": true, "hasTools": true, "hasPermission": true, "hasTime": true, "physicalPathClear": true, "obstacles": [], "costs": [], "outcomeClass": "automatic|success|success-with-cost|partial|failure-with-opportunity|impossible", "allowed": true, "reason": "" }],
    "backgroundQueue": [{ "sourceType": "task|event|trigger|thread|process|causalEffect", "sourceId": "", "decision": "carry|advance|decay|resolve|activate|discard", "reason": "" }],
    "advanceDecision": { "mode": "hold|continue|action|reveal|consequence|timeTransition|entry", "sourceRefs": [], "actorId": "", "intensity": "none|subtle|moderate", "direction": "", "reason": "" },
    "npcUpdates": [{ "characterId": "", "mode": "realtime|background|carry", "intentionalState": "", "action": "", "reason": "" }],
    "ambientResponses": [{ "actor": "一名乘客/店员/路人等临时环境人物", "trigger": "正文中可感知的动作", "response": "一次性、低强度反应", "reason": "距离、视线、音量与场所依据" }],
    "processUpdates": [],
    "causalUpdates": [{ "causeRef": "", "steps": [], "result": "", "status": "developing|active|resolved|discarded", "affectedIds": [], "evidenceRefs": [] }],
    "triggeredEventIds": [],
    "eligibleDevelopments": [],
    "forbiddenDevelopments": [],
    "meaningfulChange": { "type": "information|relationship|resource|obstacle|situation|goal|choice|clarification", "description": "", "sourceRefs": [] },
    "noPersistentChangeReasons": [],
    "notes": ""
  },
    "moduleInjections": {
    "world": "当前场景需要的世界状态",
    "factAnchors": "与当前场景相关且已经永久成立的事实锚点",
    "ambient": "当前场景可自然出现的环境反馈与一次性路人反应",
    "map": "当前地点与本轮相关的可达路线",
    "characters": "当前场景需要的人物状态",
    "npcActivities": "相关NPC最近在做什么",
    "relationships": "与本轮相关的关系约束",
    "knowledge": "需要遵守的知识边界",
    "tasks": "与本轮相关的任务",
    "events": "与本轮相关的重要事件节点",
    "triggers": "本轮相关触发条件",
    "threads": "本轮必要的长期连续性",
    "progression": "当前剧情已经形成的移动方向与下一阶段必要变化",
    "processes": "相关世界进程",
    "causalEffects": "与本轮相关且仍在生效的因果后果",
    "planner": "本轮合理发展和禁止事项"
  },
  "injection": "<WORLD_STATE>...</WORLD_STATE>"
}`;

    const RECONCILER_PROMPT = `你是世界状态的事实结算器。对比正文前状态、Planner计划与主模型实际正文，只把正文中确实发生或可直接推出的事实写入状态。

## Phantasm 世界运作逻辑（最高优先级）

Phantasm 已经内化为本插件的默认事实法则，不是可选择的模式。若下文、旧版保存提示词、Planner计划或正文附加状态与本节冲突，以本节为准：只提交已经成立且有证据的变化；维持 Canon、认知边界、因果路径、时空与身体连续性；不得把期望、猜测、隐藏推理或计划冒充事实；不得建立第二套状态源。

硬规则：
0. 每轮检查全部模块，但无实质变化的模块必须KEEP并从输出省略。APPEND不是默认操作；已有对象优先UPDATE、REPLACE或MERGE，只有正文建立了真正独立的新对象才能CREATE。不得为了“更新全部栏目”而复述、润色或扩写旧状态。
1. Planner计划但正文没有发生的内容，绝不能视为已发生。
2. 不得补写正文、猜测隐藏行动或为了连续性虚构事实。
3. 保留正文前已经完成的后台推进。
4. 更新人物位置、知识、关系、任务、事件、线程和时间线时必须有正文证据。
5. 正文中显化的因果后果必须能引用既存 rootCauseRef；不能为了给正文找解释而补造根因。
6. causalEffects 只有在正文或后台状态提供完整因果路径并且后果已经形成后才能转为 active；否则继续 developing 或在路径不成立时 discarded。事件结束不代表影响结束，后果仍有效时不得删除。
7. 正文没有提及视野外NPC时，不得据此否定正文前已经完成的后台更新；也不得补造额外后台行为。
8. 结算后的 tasks 与 triggers 必须依据本轮 user/assistant 实际正文和结算后世界状态重新判断 userVisible、userRelevance与sourceRefs。交互按钮由插件本地生成，不得创建choices，也不得把后台模块原文写成user已知事实。
8. processes 可以根据正文证据继续、转向、衰减或解决，禁止默认升级和人工维持。
9. 遵守 moduleOwnership：正文事实只写入一个权威模块，其他模块只能引用对应ID；禁止把同一句状态同时复制到world、events、processes和timeline。
10. lockedPaths 对应字段不得更改。
11. relationships 只写简单自然语言，不得生成或保留亲密度、信任度、紧张度、百分比等评分数字。
12. 正文明确呈现NPC的新行动、移动或活动完成时，更新该NPC在 npcActivities 中唯一的当前活动快照，不追加历史流水，不得记录猜测或把活动写成预定剧情。
13. 只输出严格 JSON，不要 Markdown 代码块。
14. 一次性乘客、店员、路人等环境反应可以进入 actualChanges 与时间线证据，但除非正文赋予明确身份并形成持续互动，不得创建持久 characters、npcActivities、relationships、events 或 threads。
15. 按 Canon、角色主张、Believed、Suspected、Misunderstood、Unknown 分层结算认知，并把L1/L2/L3重要性、HOT/WARM/COLD活跃度与保密/受限/公开状态分别维护。只有正文直接确认或可靠来源确认的内容才能升级为世界事实；角色猜测、谎言、传闻和误解必须保留其认知属性。
16. 用户输入中的尝试、期望结果和对NPC/世界的指定，只有正文实际裁定并呈现后才能提交为事实；不得仅因它出现在用户消息中就判定成功。
17. 同步位置、距离、持续状态、重要物品、资源消耗和实际耗时。短暂姿势、衣物、情绪、饮食和普通物品不进入人物概况；任何持久变化必须能引用正文证据，不能用状态栏补写正文没有发生的过渡动作。
18. 世界进程进度钟只在正文或已结算后台事实满足驱动条件时变化；受阻时允许停滞、倒退或转化，禁止每轮机械加格。
19. 关系只在事件足以改变人物判断时更新，并使用自然语言分别表达信任、尊重、戒备、亏欠等维度；不得因普通礼貌刷高关系，也不得用单次冲突抹除全部既有关系。
20. 线索揭示必须满足已有 evidence、discoveryPaths 或 maturityConditions；不得在揭晓时临时创造谜底、根因或证据。
21. 结算前执行STATE_GC：REMOVE无价值终态；REPLACE同一对象旧版本；MERGE同类重复；ARCHIVE值得保留的结束节点到timeline；COMPRESS久远时间线；PROTECT L3核心锚点。世界事件压成单个节点及结果，世界进程只留仍在演变的世界级变化，因果影响只留仍在形成或生效的后果。
22. 比较 preState.triggers 与本轮实际正文。若没有旧 trigger 真正触发，丢弃整批旧候选并为下一轮生成 4–8 条全新 trigger（不得沿用旧ID）；若有触发，删除 triggered/expired 项，并依据结算后状态补足 4–8 条有效候选。新候选必须有既存 sourceRefs，不能凭空制造事故或巧合。
23. L3事实锚点长期保护，只能依据明确正文证据修正或在事实失效时删除；L2活跃状态结束后降级、归档或删除；L1临时状态失效后直接覆盖或删除。已经存在于世界书、角色卡或Persona中的长期设定不得复制进factAnchors或world.currentConditions。
24. 当前型模块只保存最新版本：每个人一条概况和活动快照，每个from→to一条关系摘要，同一任务、事件、线程、进程和因果影响复用稳定ID。完成的小步骤若无独立价值立即移除；重要完成节点才写timeline。
25. timeline不是逐轮日志。没有值得回顾的新事实时省略timelineEntry；旧记录应按时间或同一事项逐渐合并为更粗摘要，L3历史不得丢失。
26. priority回答“能不能遗忘”：L3核心长期保护，L2重要阶段维护，L1临时快速消费。activity回答“本轮要不要调用”：正文直接涉及、当前在场或正在推进为HOT；近期可能相关为WARM；暂时无关为COLD。两者不得混用；L3+COLD必须保留但不得仅因重要而每轮注入。
27. 每次create/update/replace正文确实涉及的条目时设为HOT；未再次涉及的条目允许由程序自然从HOT衰减到WARM、再到COLD。再次被正文、当前人物、地点、任务或世界书检索命中时才升温。禁止为维持HOT而虚构变化。
28. 模块允许为空。空表示当前没有满足定义且值得进入运行态的信息，不表示模块失效；禁止为了填满栏目制造任务、线程、活动、秘密或事件。初始化也不得把全部世界书做成固定摘要；原始世界书始终是设定权威，状态只保存当前化结果和必要连续性。
29. progression只保存当前剧情正在向哪里移动的最新版本。它由已成立的任务、线程、人物目标、世界进程和事实归纳，不是预定剧情；方向实质变化时覆盖旧版本，不追加历史，不写保证发生的结果。长期线程回答“什么问题仍悬着”，progression回答“当前这一段正往哪里移动”。
30. progression.nextRequiredChanges只能写进入下一阶段仍需出现的条件或变化，不得替用户选择。遇到签署、跟随、告白、承诺、路线或立场等用户决策点，必须写入blockedByDecision并停在决定之前。剧情节奏只限制正文每轮推进幅度；共享骰池只在多个合理且确有不确定性的结果间提供随机倾向，二者都不得改写progression为既成结果。
31. 来自状态卡的“关注、介入、询问/调查”文本一律视为user尝试。关注只可提高记忆活跃度；介入不得直接触发事件、完成任务或改变世界；调查不得把NPC后台轨迹、未知知识、隐藏关系、因果链或历史记录直接授予user。只有正文实际裁定并呈现的结果才能结算。

输出结构：
{
  "stateDelta": {
    "statePatch": { "仅填写发生实质变化的非集合字段；未变化字段省略" },
    "collectionOps": [
      { "module": "factAnchors|resourceConstraints|characters|npcActivities|relationships|knowledge|tasks|events|triggers|threads|processes|causalEffects", "op": "create|update|replace|remove", "id": "既有稳定ID；create时为新稳定ID", "value": { "priority": "L1|L2|L3", "activity": "HOT|WARM|COLD", "其余": "create/update/replace时填写；remove时省略" } }
    ]
  },
  "actualChanges": ["正文中实际发生的变化"],
  "timelineEntry": { "summary": "只有值得长期回顾时才填写", "priority": "L1|L2|L3", "participants": [], "location": "", "evidence": [] }
}

stateDelta为空表示完整KEEP。update只提交变化字段并由程序合并；replace用一个完整当前版本覆盖旧条目；remove删除终态；create仅用于独立新对象。禁止返回完整state，禁止把未变化数组原样返回。`;

    const STATE_SCHEMA = {
        identities: { user: '当前Persona名称字符串', char: '当前角色卡名称字符串' },
        world: {
            time: { display: '叙事时间', iso: '可选 ISO 时间', timezone: '可选', elapsedMinutes: 0 },
            season: '当前季节；依据日期和地点自动确定',
            location: { current: '当前场景地点', environment: '环境', weather: '必须存在且连续演变的天气' },
            currentConditions: ['当前时刻正在生效的客观状态，最多8条'],
        },
        factAnchors: [{ id: '稳定ID', fact: '正文中已经永久成立的最终客观结果', priority: 'L3', activity: 'HOT|WARM|COLD', scope: '影响对象或范围', sourceRefs: ['正文依据'] }],
        resourceConstraints: [{ id: '稳定ID', subjectId: '受限制的人物、组织、地点或事项ID', kind: 'funds|permission|capacity|possession|access|blockade|other', condition: '当前真正限制行动的硬条件', status: 'active|satisfied|expired', amount: '仅在原文有明确数量时填写', scope: '限制适用范围', consequence: '不满足时会阻止什么', priority: 'L1|L2|L3', activity: 'HOT|WARM|COLD', sourceRefs: ['正文或设定依据'] }],
        map: {
            rootLabel: '大地图顶部显示名称',
            currentLocationId: '当前位置对应的稳定地点ID',
            locations: [{ id: '稳定地点ID', name: '地点名', type: 'world|region|country|city|district|landmark|residence|workplace|building|room|other', parentId: '直接上级地点ID，顶层为空', x: 50, y: 50, area: '兼容旧数据的所属区域显示名', description: '只描述空间本身与稳定用途', status: 'known|visited|unavailable', priority: 'L1|L2|L3', activity: 'HOT|WARM|COLD', origin: '一句人物+行为/原因，或世界设定', updatedRevision: 0, sourceRefs: ['设定或正文依据'] }],
            routes: [{ from: '起点ID', to: '终点ID', description: '移动方式或路线说明', status: 'open|blocked|unknown', travelMinutes: 0, distance: '可选距离说明' }],
        },
        characters: [{ id: '稳定ID', name: '姓名', priority: 'L2|L3', activity: 'HOT|WARM|COLD', maintenanceLevel: 'core|active', identity: '身份或稳定角色', location: '大致当前位置', present: false, situation: '当前重要处境或作用', persistentConditions: [{ name: '伤病或持续状态', effect: '对行动的影响', recovery: '治疗、恢复条件或预计进程' }], importantItems: [{ name: '重要物品', status: '持有、转交、遗失或损毁状态', significance: '为何不能忘记' }], notes: '必要的连续性摘要' }],
        npcActivities: [{ id: '稳定ID', characterId: 'NPC稳定ID', priority: 'L1', activity: 'HOT|WARM|COLD', location: '活动发生地或途中位置', movement: '从哪里到哪里、正按什么既有安排移动', action: '实际正在进行或基于既有安排持续的活动', currentRole: '对当前世界或剧情的作用' }],
        relationships: [{ id: '稳定ID', from: '主体ID', to: '对象ID', priority: 'L1|L2|L3', activity: 'HOT|WARM|COLD', type: '关系类型', status: '简单的当前关系描述', evidence: [] }],
        knowledge: [{ id: '稳定ID', information: '信息、秘密、线索或主张', priority: 'L1|L2|L3', activity: 'HOT|WARM|COLD', disclosure: 'confidential|restricted|public', knownBy: [], believedBy: [], suspectedBy: [], misunderstoodBy: [], unknownTo: [], source: '明确来源与传播渠道', certainty: 'canon|claim|confirmed|believed|suspected|misunderstood|rumor', reliability: '可靠性', relatedRefs: [], evidence: [], discoveryPaths: [], maturityConditions: [] }],
        tasks: [{ id: '稳定ID', title: '任务', priority: 'L1|L2|L3', activity: 'HOT|WARM|COLD', status: 'pending|active|blocked|done|failed', ownerIds: [], dependencies: [], deadline: '', progress: '', consequences: [], userVisible: true, userRelevance: '为什么用户现在能处理或关心', sourceRefs: [] }],
        events: [{ id: '稳定ID', title: '重要事件节点', priority: 'L1|L2|L3', activity: 'HOT|WARM|COLD', status: 'ongoing|occurred', summary: '这个节点发生了什么', outcome: '已经确认的直接结果', location: '', participantIds: [], relatedProcessIds: [], sourceRefs: [] }],
        triggers: [{ id: '稳定ID', title: '可触发事件', priority: 'L1', activity: 'HOT|WARM|COLD', conditions: [], status: 'armed|eligible|triggered|expired', effectsIfTriggered: [], blockedReasons: [], userVisible: true, userRelevance: '为什么用户能感知该可能性', sourceRefs: [] }],
        threads: [{ id: '稳定ID', title: '长期线程', priority: 'L2|L3', activity: 'HOT|WARM|COLD', status: 'open|paused|resolved', stakes: '', participantIds: [], nextNaturalStep: '', history: [] }],
        progression: { priority: 'L2', activity: 'HOT|WARM|COLD', direction: '当前这一段剧情正在向哪里发展', currentMovement: '已经成立的推进阶段或变化趋势', nextRequiredChanges: ['进入下一阶段仍需出现的关键变化或条件，不是预定结果'], basedOnRefs: ['task/thread/character/process/event/fact等既存依据ID'], blockedByDecision: '若下一步必须由用户决定，记录决策点并停止推进', updatedRevision: 0 },
        processes: [{ id: '稳定ID', title: '仍在演变的世界级变化', priority: 'L2|L3', activity: 'HOT|WARM|COLD', kind: 'organizational|political|military|economic|social|environmental|other', status: 'active|decaying|paused|resolved|transformed', drivers: [], decayConditions: [], resolutionConditions: [], progress: { current: 0, max: 0, lastChangeReason: '' }, currentDirection: '' }],
        causalEffects: [{ id: '稳定ID', causeRef: '既存事件或事实ID', priority: 'L1|L2|L3', activity: 'HOT|WARM|COLD', cause: '已经发生的起因', steps: ['起因形成后果的必要路径'], result: '仍会影响后续世界的具体后果', affectedIds: [], status: 'developing|active|resolved|discarded', reachCondition: '尚未形成时仍缺的条件', decayConditions: [], evidenceRefs: [] }],
        timeline: [{ id: '稳定ID', summary: '已发生事实或压缩历史摘要', priority: 'L1|L2|L3', activity: 'HOT|WARM|COLD', granularity: 'turn|day|phase|core', participants: [], location: '', evidence: [] }],
    };

    const INJECTION_MODULES = {
        world: { label: '世界状态', category: 'world', depth: 1, enabled: true, instruction: '只作为“此刻世界是什么样”的客观快照；不记录事件过程，也不推演未来。' },
        factAnchors: { label: '事实锚点', category: 'world', depth: 2, enabled: true, instruction: '只在与当前场景相关时使用正文已经永久确立的最终结果；COLD锚点不常驻注入。' },
        resourceConstraints: { label: '资源 / 约束', category: 'world', depth: 1, enabled: true, instruction: '行动前必须检查当前有效的资金、权限、人手、持有物、封锁及其他硬条件；不得凭空补足资源。' },
        ambient: { label: '环境与路人反应', category: 'world', depth: 0, enabled: true, instruction: '只允许由当前正文触发、符合场所与感知条件的轻量反应；临时路人不得升级为持久NPC或强制事件。' },
        map: { label: '场景地图', category: 'world', depth: 2, enabled: false, instruction: '地图是默认不注入正文的空间索引；只有用户点击地点交互时才发送最小行动意图，且不得瞬移或泄露未知地点。' },
        characters: { label: '人物概况', category: 'people', depth: 1, enabled: true, instruction: '只使用人物身份、当前落点、重要处境、持续状态与重要物品；具体移动和活动过程看NPC活动轨迹。' },
        npcActivities: { label: 'NPC活动轨迹', category: 'people', depth: 4, enabled: true, instruction: '只作为NPC具体行动与移动过程的连续性；当前落点以人物概况为准，不要复述成流水账。' },
        relationships: { label: '人物关系', category: 'people', depth: 2, enabled: true, instruction: '只描述角色怎么看待对方；具体知道哪些事实由知识与秘密约束。禁止关系评分或自动升级。' },
        knowledge: { label: '知识与秘密', category: 'people', depth: 2, enabled: false, instruction: '只约束角色实际知道、相信、怀疑或误解的事实；怎么看待对方归人物关系。重要等级与公开状态彼此独立。' },
        tasks: { label: '当前任务', category: 'affairs', depth: 3, enabled: true, instruction: '只体现已经成立且用户角色现在可以主动推进的事务；必须等待条件的内容归可触发事件。' },
        events: { label: '世界事件', category: 'world', depth: 3, enabled: true, instruction: '只体现与本轮相关的重要事件节点：发生了什么，而不是长期进程发展到了哪一步。' },
        triggers: { label: '可触发事件', category: 'affairs', depth: 4, enabled: true, instruction: '只体现尚未发生、必须先满足具体条件的一次节点；长期未决问题归线程。' },
        threads: { label: '长期线程', category: 'affairs', depth: 4, enabled: false, instruction: '只维护围绕用户角色经历、目标或未解决问题展开的长期剧情线；世界自行演变归世界进程。' },
        progression: { label: '剧情推进', category: 'affairs', depth: 3, enabled: true, instruction: '只表示当前这一段剧情已经形成的移动方向与进入下一阶段仍需的变化；它不是预定结果，不替用户决定，也不等于长期线程、剧情节奏或骰子。' },
        processes: { label: '世界进程', category: 'world', depth: 4, enabled: true, instruction: '只维护即使用户角色不参与也会继续演变的世界级变化线；围绕用户故事的未决问题归长期线程。' },
        causalEffects: { label: '因果影响', category: 'world', depth: 3, enabled: true, instruction: '只使用由既存事件或事实留下、与本轮相关且仍在生效的持续后果。' },
        pacing: { label: '剧情节奏', category: 'system', depth: 0, enabled: true, instruction: '只控制本轮允许推进的最大幅度，不规划剧情、不提高事件强度，也不得越过需要用户亲自决定的节点。关闭时本模块为空。' },
        planner: { label: '本轮后台判断', category: 'system', depth: 0, enabled: true, instruction: '采用合理发展与禁止事项；计划不是已经发生的事实。' },
    };

    const MODULE_OWNERSHIP = {
        world: '只记录“此刻世界是什么样”：当前时间、季节、地点、天气、环境，以及3至8条当前正在生效的客观状态。不保存人物背景、历史经过、未来安排、完整世界规则或永久事实库。季节按日期与地点维护；天气必须存在并服从地点、季节、时间、上一轮天气及现实气象规律，只能连续渐变。剧情氛围只能在多个合理天气分支中轻度偏置，不能成为异常天气的原因。',
        factAnchors: '只记录正文运行过程中已经确立、长期有效且遗忘会造成逻辑错误的客观最终结果。默认priority=L3；当前无关时activity=COLD且不注入。只保存结果，不保存过程；世界书原有设定、人物身份、关系状态、知识归属、历史经过、未来安排以及能被其他模块明确表达的内容不得重复进入。事实被推翻、转交、失效或由更准确版本取代时更新或删除。',
        resourceConstraints: '只记录当前真正会阻止、限制或消耗行动的硬条件，例如可用资金、进入权限、组织可调用人手、关键物品持有状态、地点封锁。它不是数值面板，也不复制人物重要物品或世界状态；只写会改变行动可行性的当前版本。条件满足、资源消耗、权限撤销、物品转交或封锁解除后立即UPDATE或REMOVE，不保留流水。',
        ambient: '不持久化实体，只为当前轮提供场所自然反馈和一次性旁观者反应。必须由实际正文中的可感知行为触发，不得创建长期NPC、关系、事件或线程。',
        map: '作为空间索引，只保存地点本身、直接上级、同级相对坐标、玩家认知、生命周期、最短溯源、当前位置和路线。严格按世界→城市→区域→建筑→内部空间分层；同名同父级同实体必须合并。description禁止保存事件经过或剧情意义。L3核心地点长期保留，L2活跃地点可降级，L1临时地点长期不用后隐藏或删除。地图默认不注入正文。',
        characters: '只保存人物的当前概况：维护等级、身份、当前大致落点、在场状态、重要处境、持续状态和重要物品。当前落点是概况，具体去了哪里、做了什么和移动过程归npcActivities。核心人物完整维护必要连续性；活跃NPC只保留身份、落点与当前作用；背景NPC不建档。不得复制关系、知识、活动过程或事件全文。',
        npcActivities: '每个核心人物或活跃NPC只保存一条当前活动/移动快照：人物、活动地点、从哪里到哪里或按什么既有安排移动、实际在做什么、当前作用。具体过程归本模块，最终大致落点回写characters；不是任务或预定剧情，不保存历史流水，背景NPC不进入。',
        relationships: '只回答“角色把另一个人当成什么人、怎么看对方”，用自然语言保存已成立关系及依据。from→to与反向认知独立，只由实际互动改变，禁止评分。角色知道哪些事实归knowledge，不得把秘密内容复制进关系描述。',
        knowledge: '只回答“角色到底知道哪些事实”。保存实际获得的信息、明确来源及各角色确认/相信/怀疑/误解/未知状态；L1/L2/L3重要性与保密/受限/公开传播状态独立。怎么看待另一个人归relationships，不得用知识条目替代关系状态。',
        tasks: '只保存已经成立、用户角色现在可以主动推进的事务、负责人、进展、依赖和截止时间。现在就能采取有效行动=task；必须等待外部条件才进入=trigger。交互按钮由本地界面生成，不保存choices；若完全无法行动且只能等待触发条件，应移出任务。',
        events: '记录“世界里正在发生或已经发生了什么重要事情”。事件是节点，每项只保存节点内容、地点、参与者和直接结果，可以与user无关并由NPC、组织、社会或环境产生。不得把多轮发展写成流水，不得复述world快照；形成长期演变时引用process，留下持续后果时引用causalEffect。',
        triggers: '只保存尚未发生、必须先满足具体条件才会进入的一次互动节点及其条件、阻碍和可能结果。等条件出现=trigger；条件满足后可转为event或生成task。持续很多轮的未解决问题归thread，不得把线程压成一个永远不触发的候选。',
        threads: '只保存围绕用户角色经历、目标或未解决问题展开、可持续多轮且不一定立刻发生具体节点的剧情线。一次具体条件节点归trigger；用户现在能推进的具体事务归task；即使用户不参与也会演变的世界级变化归process。',
        progression: '只保存一条当前剧情方向快照：当前段落正往哪里移动、已经形成的变化趋势、进入下一阶段仍缺什么，以及是否停在用户决策点。长期线程保存长期未决问题；本模块保存当前段落的移动方向。它不是历史、任务、结果预测、剧情节奏设置或骰子裁定。',
        processes: '记录即使用户角色不参与也会继续演变的世界级变化线。只保存家族、组织、战争、公司权力、政策、舆论或大型环境等变化的驱动、当前方向与结束条件。围绕用户经历和故事目标的未决问题归threads；具体发生点归events。',
        causalEffects: '记录“之前发生的事留下了什么仍有效的后果”。保存既存起因、必要因果路径、具体后果、受影响的人物/组织/资源/关系/社会环境/后续条件，以及影响何时减弱或消失。后果形成后标记active并持续保留，直到真正失效才resolved；同根因同结果合并。不得复述事件节点、世界进程或当前快照。',
        timeline: '只用于回顾已经确认发生过什么，每件事记录一次，仅供用户查看。仍在影响当前世界、值得单独关注的重要节点可同时由events以ID关联保留当前意义，但不得复制完整描述；失去当前影响后只留timeline。',
        pacing: '不保存剧情计划或事实，只把用户选择的推进速度、自动切场景许可和自动时间跳跃许可转换为正文约束。速度只控制推进幅度，不等于事件强度；任何模式都必须停在用户决策点。',
        planner: '只保存本轮可以怎样发展、不要怎样发展和无变化理由。不得冒充状态或历史。',
    };

    const MODULE_PROMPTS = {
        world: '维护“此刻世界是什么样”的纯客观快照，固定字段为当前时间、当前季节、当前地点、天气、环境、当前客观状态。currentConditions只留3至8条当前直接生效的结果，不写人物背景、历史经过、未来安排、完整世界规则或永久事实库。季节根据日期和地点确定，通常只在跨季或明显气候区变化时更新。天气必须填写并延续上一轮：优先服从地点、季节、时间与现实气象规律，只允许晴→多云→阴→小雨→大雨、雨停→多云等连续变化；存在多个合理方向时剧情氛围可轻度偏置，但不得为配合情绪突然制造不合理极端天气。',
        factAnchors: '维护正文已经永久确立的最终客观结果，默认L3。只保存遗忘后会造成逻辑错误且不能由世界书、人物、关系、知识、任务、事件或时间线明确替代的事实；不保存形成过程和未来安排。同一事实只保留一个当前版本，COLD时不常驻注入，失效或被新事实取代后更新或删除。',
        resourceConstraints: '维护当前会实际限制行动的少量硬条件。只记录资金是否足够、身份/门禁/法律权限、组织可调用能力、关键物品是否持有、地点是否封锁等会改变可行性的事实；没有明确依据不得猜测数量。行动裁定前逐条检查，不得凭空生成钱、人手、交通、门卡、许可或物品。条件改变时覆盖当前版本，满足或失效后删除；不做完整资产清单，不记录普通日用品，不与characters.importantItems重复。',
        ambient: '先读取 source.chat 的实际酒馆正文，再判断公共或半公共场景中是否存在合乎距离、视线、音量和场所规范的轻量环境反应。允许无反应；临时乘客、店员或路人不得写入持久人物状态，也不得夸张升级。',
        map: '维护空间索引而非地点记忆库。严格用parentId组织世界→城市→区域→建筑→内部空间；同名+同父级+同实体只能有一个稳定节点，更新时MERGE而非APPEND。每个地点只保留稳定空间说明，并有一句origin说明首次为何进入系统（世界书地点写“世界设定”，正文地点写最短“人物+行为/原因”）；不得把谈判、冲突、交割、主要场景等历史或剧情意义写入description。内部按L3核心、L2活跃、L1临时维护：一次性餐厅、咖啡馆、酒店房间等长期未使用后降级并淘汰，核心城市、长期住所和组织总部保留。地图默认不注入正文，用户交互只能发送行动意图；移动受层级路径、距离、时间、交通、权限与路线阻断限制，禁止瞬移或泄露未知地点。',
        characters: '维护“他是谁、在哪里、当前重要处境、有什么持续影响、有哪些不能忘的重要物品”。人物可在background→active→core之间按持续作用升级，也可在长期无出场且无未决事项时降级；background不建立长期记录。persistentConditions必须写明行动影响与恢复逻辑，并随时间、治疗和行动自然减轻、恢复、恶化或移除；importantItems只收录与人物绑定且影响连续性的物品，并在遗失、转交、损毁或失去价值后更新或删除。两类都只保留当前版本。不要记录短暂情绪、姿势、衣物、饮食和普通日用品。',
        npcActivities: '维护NPC离开玩家视野后实际发生或基于既有安排正在进行的具体活动与移动：去了哪里、做了什么、正从哪里前往哪里。每人只保留一条当前过程快照，最终落点同步到人物概况；carry模式不新增。这不是预定剧情或任务，背景NPC不持久化。',
        relationships: '只维护角色怎么看待另一个人：身份关系、熟悉程度、亲疏、信任、冲突或利益联系及形成依据。双方认知独立，不自动对称或升级，禁止评分。具体知道哪些事实必须放入knowledge。',
        knowledge: '只维护角色知道什么：每条信息必须有明确来源，并按角色分别记录确认、相信、怀疑、误解或未知。L1普通、L2重要、L3核心决定保留优先级，与保密/受限/公开传播状态独立；L3不得自动删除。角色如何看待另一个人必须放入relationships。',
        tasks: '维护已经成立且用户角色现在能主动推进的事务。现在能采取有效行动才是task；若必须等待尚未满足的外部条件，应转为trigger或由thread保留长期问题。不要生成choices，界面会把卡片转换为不预判结果的玩家意图。',
        events: '维护重要事件节点：正在发生或已经发生了什么、地点、参与者和已确认的直接结果。事件可以与当前玩家角色无关，由NPC、组织、社会或环境自然产生。每项是节点而非多轮流水；长期演变归process，持续后果归causalEffects，不要重复世界快照或把尚未发生的事写进来。',
        triggers: '维护4至8条尚未发生、必须先满足具体条件的一次互动节点。等待条件=trigger；满足后转成event或可主动推进的task。持续存在的问题归thread。记录sourceRefs、条件、阻碍和可能结果，候选不跨轮囤积，隐藏信息不得泄露，条件未满足不得提前触发。',
        threads: '维护围绕用户角色经历、目标或未解决问题展开的跨多轮剧情线、重要性、相关人物和自然下一步。一次条件节点归trigger，现在能做的具体事务归task；世界不依赖用户也会演变的变化归process。不要强迫每轮推进。',
        progression: '维护当前剧情方向的唯一最新版本。根据已经成立的tasks、threads、人物目标、processes、events与客观事实，概括当前段落正向哪里移动、已经进入什么阶段，以及下一阶段仍需哪些关键变化。只写自然延伸出的方向和必要条件，不预写具体结果，不制造事件，不替用户行动；遇到用户决策点写blockedByDecision并停止。方向无实质变化时KEEP，变化时覆盖旧版本，不保存流水。',
        processes: '维护即使用户角色不参与也会继续演变的世界级变化，如家族斗争、战争局势、公司权力更替、政策变化、舆论发酵或大型环境变化。围绕用户故事展开的未决问题归threads，具体节点归events。记录驱动、方向和停滞/衰减/结束条件。',
        causalEffects: '维护“既存事件或事实→必要现实路径→仍会影响后续世界的后果”。后果可作用于人物、组织、资源、关系、社会环境或后续事件条件；形成后标记active并保留，随时间和条件减弱，真正失效后才resolved。安排人物行动前仍须检查动机、能力、机会、知识、工具、权限、时间、距离、环境、物理路径、阻碍与代价。不得夸张升级、瞬移、巧合获知秘密或临时创造重要人物；未形成时为developing且不进入正文。',
        timeline: '只用于历史回顾，记录正文已确认发生的事实，每件事一次，仅供面板展示。仍影响当前世界的重要节点由events保留当前意义；事件失去当前影响后只留timeline。不得记录计划、重复当前状态或进入正文注入。',
        pacing: '将剧情节奏设置解释为“正文模型本轮最多推进多少”，不是替正文模型规划下一段剧情。关闭时不产生任何额外要求；极慢只处理当前动作、对白与直接反馈；慢速最多一个很小变化点；中速可自然完成一个节点并使用已有事件或线程；快速可跳过低价值过程进入下一阶段。任何速度都不提高事件强度，不得创造无依据事件，不得替用户选择、承诺、签署、告白、跟随或切换立场。场景与时间跳转还必须分别获得设置许可。',
        planner: '先按 LOAD→PARSE→ADJUDICATE→ADVANCE 读取实际正文：拆分元指令、对白、自主动作、行动尝试、期望结果和时空跳转；尝试与期望不得预判成功。维护场景目标、在场者、地点边界、核心阻碍、张力、可交互点与结束条件。再判断 flowing、quiet、slowing 或 stalled（停滞），并从用户行动、人物自然回应或既有后台事项中选择一个有意义变化点；平静可以低强度，但不能重复气氛原地空转。tasks、events、triggers、threads、processes、causalEffects 只用 sourceType 与 sourceId 引用，逐项决定 carry、advance、decay、resolve、activate 或 discard。通常一轮最多一个变化点；不得凭空加入袭击、灾难、阴谋、陌生人物或跨尺度事件，不得替用户决定路线、承诺、亲密行为或内心立场。reveal 只能揭示已有且满足发现路径的线索，entry 只能来自既有人物与可解释行程。计划不等于事实。',
    };

    function createState() {
        return {
            schemaVersion: 20,
            initialized: false,
            revision: 0,
            updatedAt: Date.now(),
            identities: { user: '', char: '' },
            world: {
                time: { display: '', iso: '', timezone: '', elapsedMinutes: 0 },
                season: '',
                location: { current: '', environment: '', weather: '' },
                currentConditions: [],
            },
            factAnchors: [],
            resourceConstraints: [],
            map: { rootLabel: '大地图', currentLocationId: '', locations: [], routes: [] },
            characters: [],
            npcActivities: [],
            relationships: [],
            knowledge: [],
            tasks: [],
            events: [],
            triggers: [],
            threads: [],
            progression: { priority: 'L2', activity: 'WARM', direction: '', currentMovement: '', nextRequiredChanges: [], basedOnRefs: [], blockedByDecision: '', updatedRevision: 0 },
            processes: [],
            causalEffects: [],
            timeline: [],
            planner: { lastRunAt: 0, turnKey: '', plan: null, moduleInjections: {}, injection: '', error: '' },
            runtime: { lastSettledMessageId: '', lastUserMessageId: '', sourceFingerprint: '', sourceSummary: null, npcLastUpdatedElapsedMinutes: {}, needsWorldRefresh: false },
            lockedPaths: [],
        };
    }

    WSM.Defaults = { PLANNER_PROMPT, RECONCILER_PROMPT, STATE_SCHEMA, INJECTION_MODULES, MODULE_OWNERSHIP, MODULE_PROMPTS, createState };
})();
