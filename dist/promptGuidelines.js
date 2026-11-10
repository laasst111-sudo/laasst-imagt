// ============================================================
// v2.4 promptGuidelines.ts —— 提示词规范唯一事实源
// ------------------------------------------------------------
// 本模块把「热门提示词结构与规律分析」（80 条语料全量统计 + 逐条
// 人工校订）的结论，沉淀成**两份系统提示词共享**的规范片段：
//
//   ① 抽取系统提示词（第一阶段 LLM）：怎么把正文拆成 tags / description
//   ② 审核系统提示词（第二阶段 LLM）：怎么审别人已经写好的提示词
//
// 为什么要单独成文件：
//   - 两份提示词必须引用**同一套事实**（维度顺序、长度区间、权重档位、
//     矛盾对…）。以前它们各写各的，结果抽取阶段要求"2~3 句完整句子"、
//     审核阶段却要求"不得引入权重括号"，互相打架。
//   - 规范要能被**测试**引用（prompt_matrix_test.mjs 断言提示词里确实
//     写了这些规则），不能只活在提示词字符串里。
//
// 所有数字均来自语料实测，来源见每节注释。
// ============================================================
// --------------------------------------------------
// 1. 维度顺序（实测：80 条语料按逗号/换行切分后 3254 个 tag 单元的
//    平均相对位置，0=最前、1=最后）
// --------------------------------------------------
export const TAG_DIMENSION_ORDER = [
    { dim: "分级旗标", pos: 0.21, note: "sensitive / explicit / nsfw / safe 等安全分级与画风旗标" },
    { dim: "角色数量", pos: 0.27, note: "1girl / 2girls / 1boy / solo / multiple boys" },
    { dim: "风格渲染", pos: 0.36, note: "anime coloring / 3d, realistic / flat vector / painting" },
    { dim: "外观身体", pos: 0.49, note: "发色 发型 瞳色 肤色 体型（语料中占 tag 单元 31.8%，最大维度）" },
    { dim: "服装道具", pos: 0.50, note: "由外到内：uniform → shirt → skirt → thighhighs" },
    { dim: "表情视线", pos: 0.52, note: "looking at viewer / blush / half-closed eyes / ahegao" },
    { dim: "动作互动", pos: 0.53, note: "from behind / on all fours / spread legs 等 Danbooru 动作短语" },
    { dim: "镜头构图", pos: 0.55, note: "dynamic angle / from above / cowboy shot / depth of field" },
    { dim: "场景环境", pos: 0.60, note: "indoors → 具体场所 → night 三层嵌套" },
    { dim: "光影氛围", pos: 0.65, note: "rim light / volumetric lighting / candle light / chiaroscuro" },
    { dim: "文字音效", pos: 0.77, note: "speech bubble / thought bubble / sound effects / typography（实测垫底）" },
];
export const TAG_ORDER_LINES = [
    "标签顺序按下列维度依次排列（实测：被采用的热门提示词 80% 遵循这个骨架，顺序越靠前权重越高）：",
    ...TAG_DIMENSION_ORDER.map((d, i) => `  ${i + 1}. ${d.dim}（${d.note}）`),
    "同一维度内：先身份、再外观、再服装；不要把不同维度交错排列。",
];
// --------------------------------------------------
// 2. 标签书写规范
// --------------------------------------------------
/**
 * 全局输出禁令（三种模式都适用）。
 * 依据：插件既定决策「不采纳画师串 / 质量提示词 / 负面提示词自动组词」，
 * 且实测语料 80 条中质量词 0 条使用、画师串 0 条使用。
 * 放在通用层而非 tags 域 —— 因为它约束的是**最终提示词**，不只标签段。
 */
/**
 * v2.6：**语料实测词表** —— 按维度给出「优先用」的写法（括号内为 80 条语料里的实测出现次数）。
 *
 * 为什么要有这张表：模型自由发挥时会写出大量「语料 0 次」的稀有词
 * （white light / overhead lighting / closed curtains / furrowed brow / sagging breasts /
 *   pale skin / low ponytail / centered composition …）—— 这些词对画面没有贡献，
 *   只会稀释信号、增加噪点。把实测词表喂给模型，比抽象描述「用常见标签」有效得多。
 */
export const CORPUS_VOCAB_LINES = [
    "## 语料实测词表（括号内 = 80 条实测热门提示词里的出现次数；优先用这些词）",
    "- **景别/机位**：full body(2)、wide shot(3)、close-up、cowboy shot、side view(2)、from above(4)、from behind(2)、from front、from side、dutch angle(2)、dynamic angle(17)、male pov(2)、looking at viewer(18)、pantyshot(2)、depth of field(17)",
    "- **构图**：cinematic composition(2)、dynamic composition(2) —— 语料里只有这两种写法；不要写 centered composition / rule of thirds（语料 0 次）",
    "- **光影**：high contrast(5)、dim lighting(3)、soft lighting(2)、bright lighting(1)、cinematic lighting(2)、dynamic lighting(2)、backlighting(2)、ambient glow(1)、candlelight、sunlight、moonlight、shadow(16)、(bloom effects)(6)",
    "  - 语料 0 次、别用：white light、overhead lighting、hard light",
    "- **表情**：blush(10)、blushing(5)、smile(5)、half-closed eyes(3)、closed eyes(3)、expressionless(2)、frown(1)、forced smile(1)",
    "  - 语料 0 次、别用：furrowed brow（蹙眉写 frown）",
    "  - **面部不可见时（背对镜头 / 出画 / 被遮挡）不写任何表情标签**",
    "- **体型**：large breasts(9)、huge breasts(4)、small breasts(4)、hanging breasts(4)（下垂感用这个）、wide hips(3)、navel(4)、thighs(2)、muscular(2)、petite(2)、slender(2)",
    "  - 语料 0 次、别用：sagging breasts（会被归一为 hanging breasts）",
    "  - 同向组合合法：large breasts + hanging breasts；异向组合非法：large breasts + sagging breasts",
    "- **肤色**：fair skin(5)、tanned skin、tanlines、flushed skin、glistening skin、freckles、dark skin —— 直接写 fair skin，不要写 pale skin（会被归一为 fair skin）",
    "- **发型**：long hair(8)、black hair(2)、medium hair、bangs、swept bangs、side ponytail、ponytail(3) —— 语料 0 次：low ponytail（写 ponytail 即可）",
    "- **场景**：indoors(7)、outdoors(4)、bedroom、bedroom background、luxurious bedroom、dark room、living room、bathroom、window(3)、on bed(2)、bed、canopy bed、huge bed",
    "  - 场景**只写三层**：indoors → bedroom → on bed；其它家具（chair / desk / sofa）**不进标签**（语料 3 次 chair 全在桌前场景，与床无关）",
    "  - 场景家具**不写材质**（语料 0 次 wooden bed）；材质只给服装与道具",
    "  - 语料 0 次、别用：closed curtains（写 curtains）",
    "- **道具/缺失**：faceless male(10)、head out of frame(3)、no bra、no panties、blindfold、no footwear",
    "  - 颜色**单列**：blindfold + black（不要 black blindfold 这种复合词）",
    "- **动作**：on all fours、kneeling、arched back、bent over、penetration(9)、sex from behind(3)、from behind、doggystyle、ass ripple、tiptoes、spread legs",
];
/**
 * v2.6：散文（Natural Language）侧的语料句式 —— 教模型「怎么写增量」而不是「堆标签」。
 * 取自 80 条语料里 29 条含完整句的 86 个句子。
 */
export const PROSE_VOCAB_LINES = [
    "## 散文句式参考（语料实测写法）",
    "- **三层结构（按序写，无必要信息不强行补全）：**",
    "  1. 主体与静态姿态：主角是谁 + 最具识别性外观（发色/发长/关键服装） + 静态姿态 + 视线",
    "  2. 角色互动与空间关系：其他角色位置/独占特征 + 与主角的接触关系 + 前景/中景/背景层级",
    "  3. 镜头/环境/光影收束：关键取景距离/机位 + 环境锚点 + 主光源与阴影（不引入新信息）",
    "- 镜头用**完整从句**开篇，不要用三连前置短语：`A full body shot of the woman…` / `The camera angle is from above, …` / `Wide shot of the room…`（语料 29 条散文句里 11 条这样开篇）",
    "- 光影用**具体光源 + 质感**：`a single hard shaft of light from the window` / `dim candlelight` / `the overhead lamp casts her shadow across the floorboards`（语料 shadow 出现 16 次）",
    "- 空间用**位置关系**：`in the corner of the room` / `on the far side of the bed` / `between his knees`",
    "- 动作写**同时存在的状态**（一两句带过，不铺开过程）：`she kneels on all fours, her back arched, gripping his wrist`",
    "- **镜头词已在 Hard Tags 段** → 自然语言只做增量，不重复镜头参数。"
];
/**
 * v2.6：**精炼与降噪**规则 —— 直接决定画面干不干净。
 */
export const PRECISION_LINES = [
    "## 精炼与降噪（决定画面是否干净）",
    "**一个信息只写一次**：标签层写了外观/服装/场景，散文就不要复述（实测最常见的噪点：标签 `nude` 散文又写 naked；标签 `black hair` 散文又写 black-haired；标签 `on bed` 散文又写 wooden bed）。",
    "**只抓影响画面的主要元素**，按这个优先级取舍（靠后的可省）：",
    "  ① 身份与人数（1girl / 1boy / 关系 / 画外人物的缺失标签） ② 姿态与动作 ③ 裸体状态与关键身体特征 ④ 外观（发色/发长/肤色/眼） ⑤ 景别与机位 ⑥ 场景锚点 ⑦ 光影基调",
    "**删掉三类噪点**：",
    "  ① 语料 0 次的稀有词（white light / overhead lighting / closed curtains / furrowed brow / sagging breasts / low ponytail / centered composition）—— 对画面没有贡献，只稀释信号；pale skin 会被归一为 fair skin，直接写 fair skin；",
    "  ② 与另一层重复的同义复述；",
    "  ③ 矛盾或被否定的元素（写了 windowless 就不该同时写 closed curtains；写了 nude 就不要写 no bra / no panties）。",
    "**标签数量**：单角色 **20~28 个**（宁可少写也不要堆），多角色 30~40 个。",
    "**散文长度**：单角色 **2 句、40~50 词**；语料 80 条里有 53.8% **完全没有散文段** —— 散文只用来写标签写不了的东西（空间关系 / 光影质感 / 动作过程 / 画面文字）。",
    "**场景只写锚点**：indoors → bedroom → on bed 三层足够；房间里的其它家具、窗帘、墙面细节不进标签、也不进散文。",
    "**表情只在脸可见时写**：背对镜头、出画、脸被遮挡时不要写任何表情标签。",
];
/**
 * v2.6：输出前自检清单（把散落的规则收敛成一次可执行的自查）。
 * 按模式过滤：tags 模式不该出现散文语法条目（纯噪声），description 模式不该出现标签条目。
 * custom 模式：不执行自检（用户自负），modes 包含 custom 以通过类型检查但实际不匹配任何条目。
 */
export const OUTPUT_SELF_CHECK = [
    { modes: ["tags", "mixed"], line: "1. 分级恰好一个且在 tags 段最前，人数/性别紧随其后。" },
    { modes: ["tags", "mixed"], line: "2. tags 里没有语料 0 次的稀有词（white light / overhead lighting / closed curtains / furrowed brow / sagging breasts / low ponytail / centered composition）；肤色写 fair skin 而不是 pale skin。" },
    { modes: ["tags", "mixed"], line: "3. tags 里没有同义三连（nude+no bra+no panties / blindfold+black blindfold / bed+on bed+wooden bed），也没有异向体型堆叠。" },
    { modes: ["tags", "mixed"], line: "4. 画外人物写了 `1boy` + `faceless male` + `head out of frame` 三件套。" },
    { modes: ["tags", "mixed"], line: "5. 面部不可见时没有表情标签。" },
    { modes: ["tags", "mixed"], line: "6. 两层之间没有同一个信息写两遍。" },
    { modes: ["tags", "mixed"], line: "7. 两层之间没有互相矛盾的场景元素（窗 / 无窗、床 / 椅子）。" },
    { modes: ["description", "mixed"], line: "8. description 每句 10~29 词、逗号 ≤3、完整主谓、现在时、主动语态、不用 she/her/his 指代动作对象。" },
    { modes: ["description", "mixed"], line: "9. 散文 2 句、40~50 词，只写标签写不了的东西（空间关系 / 光影质感 / 动作状态 / 画面文字）。" },
    { modes: ["tags", "mixed"], line: "10. 标签数量在 20~28（单角色）/ 30~40（多角色）。" },
    { modes: ["mixed"], line: "11. description 按三层结构（主体姿态 → 互动空间 → 镜头环境光影），无必要信息不补全。" },
    { modes: ["mixed"], line: "12. tags 段角色数量标签不重复（multiple 类不重复）；非焦点角色缺失标签按语义选择而非默认全加。" },
];
export const FIELD_CONTRACT = [
    {
        name: 'description',
        role: '唯一最终生图文本（Natural Language），2-3句完整英文句子',
        required: true,
        defaultSource: 'llm',
        goesToFinalPrompt: true,
        dedupWith: ['tags', 'mainSubject', 'environment', 'optics'],
        description: '承担空间关系、光影质感、动作状态、画面文字；不重复tags已给的外观/服装/人数/镜头'
    },
    {
        name: 'tags',
        role: 'Hard Tags：身份/数量/外观/服装/场景/动作/镜头/光影/文字音效',
        required: true,
        defaultSource: 'llm',
        goesToFinalPrompt: true,
        dedupWith: ['description'],
        description: '按维度顺序：分级→人数→风格→外观→服装→表情→动作→镜头→环境→光影→文字；全小写、空格分词、逗号分隔；不写句子'
    },
    {
        name: 'mainSubject',
        role: '主体身份与关键视觉特征（供程序校正/构建主体行）',
        required: true,
        defaultSource: 'llm',
        goesToFinalPrompt: false,
        dedupWith: ['description', 'tags'],
        description: 'age/gender必填；pose/spatial/action各1个规范值；hair/eyes/skin/body/face/clothing仅有出处时填；species仅非人类种族填；sexWith仅插入方填'
    },
    {
        name: 'secondarySubjects',
        role: '次要角色数组（0-2个，结构同mainSubject）',
        required: false,
        defaultSource: 'llm',
        goesToFinalPrompt: false,
        dedupWith: ['description', 'tags'],
        description: '无次要角色时输出空数组；多角色隔离靠位置+独占特征'
    },
    {
        name: 'environment',
        role: '环境整句（地点: 细节+光照，无A前缀、无句号）',
        required: false,
        defaultSource: 'llm',
        goesToFinalPrompt: true,
        dedupWith: ['description', 'tags', 'setting', 'lighting'],
        description: '作为最终环境行唯一来源；缺失时回退setting+lighting组装'
    },
    {
        name: 'optics',
        role: '程序读取的镜头参数（供resolveOptics校正/标签化）',
        required: false,
        defaultSource: 'llm',
        goesToFinalPrompt: false,
        dedupWith: ['description', 'tags'],
        description: 'subjectDirection/cameraAngle/distance/focusTarget/depthOfField/composition/perspective/intent；缺省由代码补默认'
    },
    {
        name: 'setting',
        role: '环境标签短语（3-6词，environment缺失时兜底）',
        required: false,
        defaultSource: 'llm',
        goesToFinalPrompt: false,
        dedupWith: ['environment', 'tags'],
        description: '与lighting配合作为environment缺失时的回退源'
    },
    {
        name: 'lighting',
        role: '光照标签短语（1-3术语，environment缺失时兜底）',
        required: false,
        defaultSource: 'llm',
        goesToFinalPrompt: false,
        dedupWith: ['environment', 'tags'],
        description: '同上'
    },
    {
        name: 'summary',
        role: '场景/光影概括短语（仅插件内部需要时保留）',
        required: false,
        defaultSource: 'llm',
        goesToFinalPrompt: false,
        dedupWith: [],
        description: '可省略'
    },
    {
        name: 'povHands',
        role: 'POV手部动作与锚点',
        required: false,
        defaultSource: 'llm',
        goesToFinalPrompt: true,
        dedupWith: [],
        description: 'POV场景且有物理接触时输出'
    },
    {
        name: 'povBody',
        role: 'POV出镜身体部位tag（仅性行为且生殖器可见时）',
        required: false,
        defaultSource: 'llm',
        goesToFinalPrompt: true,
        dedupWith: [],
        description: '格式如 pov from male, pov crotch, penis, penetration'
    },
    {
        name: 'isPovScene',
        role: 'POV判定结果（由代码注入，LLM不输出）',
        required: false,
        defaultSource: 'code',
        goesToFinalPrompt: false,
        dedupWith: [],
        description: '前置判定模块写入'
    }
];
export const PROMPT_OUTPUT_EXCLUSIONS = ["## 全局输出禁令（无论哪种输出模式都适用）",
    "- **不写画师串**：不要输出 @artist。",
    "- **不写质量咒语**：不要输出 masterpiece / best quality / absurdres / highres / score_1~score_9 / very aesthetic（实测热门提示词 0 条使用；模型默认画质已足够，质量词只会挤占标签预算并引发画风漂移）。**质量词由用户在设置里手动提供**，插件会把它放到标签段的风格位（分级与人数之后）—— 你不要自己写。**自然语言优先：标签段只写身份/外观/数量等标签擅长的信息，空间/光影/动作状态等句子擅长的信息归 description。**",
    "- **不写负向提示词**：不要输出 negative prompt、don't、no 等否定块；缺失用正面词表达（见下）。",
    "- **不写臆造词**：只输出 Danbooru 里真实存在的标签形态（`aesthetic` 的规范写法是 `anime aesthetic`；没有 `very aesthetic` 这种形式）。",
];
export const TAG_SYNTAX_RULES = [
    "## tags 字段书写规范",
    "- **多词标签用空格，不用下划线**：`black hair`（不是 `black_hair`）。依据 Anima 格式规范「标签使用小写，空格替换下划线」；只有 `score_1`~`score_9` 保留下划线。",
    "- **全小写**，不用标点结尾（不要句点、不要逗号结尾）。",
    "- **只写标签，不写句子**：tags 里不得出现主谓结构、不得出现句号。",
    "- **作品名转义括号**：角色/作品名用 Danbooru 语法 `角色名 \\(系列名\\)`，例如 `noelle \\(genshin impact\\)`；系列名要重复写（每个角色名后面跟一次），可防止多角色串脸。",
    "- **安全分级必须恰好一个**：`safe` / `sensitive` / `nsfw` / `explicit`，按正文实际内容选（正文没有涉敏内容就写 `safe`）；不要同时写多个，也不要一个都不写。分级要放在**标签段最前面**。",
    "- **缺失用正面词表达**：想要「不给脸 / 出画 / 不画下半身」时写 faceless / head out of frame / male face out of frame / no bra / no panties / upper teeth only / unworn —— 不要写成「不要 X」。",
    "- **画外人物必须给标签**：正文里有画面外参与者（画外男性、只出手、只入镜一半）时，tags 里必须写出来（`1boy` + `faceless male` + `head out of frame`），否则模型会认为画面里只有一个人。",
    "- **镜头/构图词写进 tags**：`cowboy shot` / `from above` / `from behind` / `centered composition` / `depth of field` 属于 Hard Tags 的第 7 维度；正文里**不要**再重复这些词。",
    "- **同义标签不要堆成三连**：`nude` + `no bra` + `no panties`（择一即可）、`blindfold` + `black blindfold`（择一）、`bed` + `on bed` + `wooden bed`（择二）—— 同义堆叠只在**同向且强相关**时才有意义（如 `huge breasts, soft breasts`）。",
    "- **同向堆叠、异向不堆**：`large breasts` 与 `sagging breasts`、`muscular thighs` 语义不同向（丰满/松垮 vs 健壮），同时写会产生拉扯；同一体型维度只保留一个方向。",
    "- **允许重复**：同一标签重复 1-2 次是最常见的强调手段（实测 33.8% 的提示词内部存在重复标签），关键属性重复 1-2 次比加权重更稳。**角色数量标签（1girl/2girls/multiple girls 等）不重复作为强调手段；multiple 类模糊词不重复。**",
];
// --------------------------------------------------
// 3. 权重纪律（实测：69 处权重 / 20 条提示词 = 25% 的提示词用权重；
//    强化 91.3%、弱化 8.7%；被加权最多的是风格类 23%）
// --------------------------------------------------
export const TAG_WEIGHT_RULES = [
    "## 权重（节制使用）",
    "- 权重是**补丁不是基本盘**：只有 25% 的热门提示词用权重，平均每条仅 3~5 处；没有明确取舍需求时不要加。",
    "- 语法：单层 `(tag:1.2)`；双层 `((tag))` 表示打包+强化，仅用于画风类复合概念；数值 >1 强化、<1 抑制。",
    "- 常用档位：微调 1.1~1.2 / 明显强化 1.3~1.6 / 强强调 1.8~2.0 / 抑制 0.3~0.8。",
    "- **优先给风格类加权**（实测占加权对象的 23%，因为多风格词互相抵消）：如 `(flat color:1.2)`、`(vivid colors:1.3)`、`(narrow lineart:1.5)`。",
    "- 抑制只用于「明确要排除的元素」：如 `(anime coloring:0.3)`、`(half closed eyes:0.3)`。",
    "- **不给人数标签加权**（1girl / 2girls 等）：加权会破坏计数语义。",
    "- 单条提示词的权重总数控制在 3~6 处；超过 10 处属于「逐像素指定」，维护成本极高。**角色数量标签（1girl/2girls/multiple girls 等）不重复作为权重手段**。"
];
// --------------------------------------------------
// 4. 长度预算（实测：中位 658 字符 / 100 词 / 39 个 tag 单元 / 2 行；
//    单角色 300~700，复杂场景 900~1300，最长 1850）
// --------------------------------------------------
export const LENGTH_BUDGETS = {
    single: { chars: "300~700", tags: "25~45", note: "单角色 / 常规构图（占语料大多数）" },
    multi: { chars: "900~1300", tags: "50~80", note: "多角色 / 复杂场景" },
    tagsOnly: { chars: "150~450", tags: "20~40", note: "只解析标签" },
};
/** 长度预算（标签视角：字符 + 标签条数） */
export const LENGTH_BUDGET_LINES = [
    "## 长度预算（按目标场景选择，不要超标）",
    `- 单角色 / 常规构图：${LENGTH_BUDGETS.single.chars} 字符、${LENGTH_BUDGETS.single.tags} 个标签 —— ${LENGTH_BUDGETS.single.note}`,
    `- 多角色 / 复杂场景：${LENGTH_BUDGETS.multi.chars} 字符、${LENGTH_BUDGETS.multi.tags} 个标签 —— ${LENGTH_BUDGETS.multi.note}`,
    `- 只解析标签：${LENGTH_BUDGETS.tagsOnly.chars} 字符、${LENGTH_BUDGETS.tagsOnly.tags} 个标签 —— ${LENGTH_BUDGETS.tagsOnly.note}`,
    "- 行数不是长度指标：一行一个语义槽位（外观一行、动作一行、镜头一行…），行数多不代表长。",
];
/** 长度预算（自然语言视角：字符 + 句数）—— 与标签视角口径不同，不能混用 */
export const LENGTH_BUDGET_LINES_DESC = [
    "## 长度预算（按目标场景选择，不要超标）",
    `- 单角色 / 常规构图：${LENGTH_BUDGETS.single.chars} 字符、2~3 句（语料大多数）`,
    `- 多角色 / 复杂场景：${LENGTH_BUDGETS.multi.chars} 字符、3~5 句（每角色一句）`,
    "- 单句 10~29 词；超过 40 词必须拆句。",
];
// --------------------------------------------------
// 5. 自然语言（description）语法规范
//    实测：86 个完整句，100% 陈述句；67.4% 含 -ing；96.5% 主动语态；
//    37.2% 以角色名开头；主语为代词仅 12.8%；`but`/`because`/`which` 0 次；
//    逗号是主力分隔符（每句 2.3 个），分号仅 4 次且只做「状态/结果」二分；
//    修饰词占比 67.5%（日常英语约 50%）
// --------------------------------------------------
export const DESCRIPTION_SYNTAX_RULES = [
    "## description 字段语法规范（严格按此写，这是可被 CLIP 稳定解析的写法）",
    "1. **只写陈述句**。不写疑问句、不写感叹句（画面里要出现的文字除外）。",
    "2. **用现在时**（is holding / are pressing / kneels / leans），不用过去时与完成时 —— 照片永远是「正在发生的瞬间」，过去时会引入时间线。",
    "3. **用主动语态**。只有表达「被迫」或描述背景人群时才用被动（is forced / are seated）。**主体自身的状态不要用被动**（写 `A black cloth blindfold covers her eyes`，不要写 `is tied over her eyes` —— 后者会凭空引入一个「谁系的」施动者）。",
    "4. **主语优先用角色名或 `The + 外貌特征 + 名词`**（Princess Peach / The black-haired woman），其次才用代词；几乎不用第一人称（POV 时指代叙述者写 viewer / viewer's）。",
    "5. **每句 10~29 词**（实测中位 21 词，10~29 词区间占 64%）；超过 40 词必须拆成两句。",
    "6. **逗号是主力分隔符**（每句约 2 个）；需要切成两个独立小句时才用分号（实测 86 句里只有 4 次）。",
    "7. **每句都是完整主谓结构**，不要写成名词短语流水（`long hair, black hair, lying on bed` 这类交给 tags）。**禁止无主语的前置碎片串**（`in a cowboy shot, from a high angle, in a centered composition,` 这种三连短语会让整句失去主语）。",
    "8. **方位关系必须写出来**（谁在上、谁在下、谁在左、谁在右、在谁的上面/之间/脚下）—— 这是 tag 表达不了、只有自然语言能补的部分，也是多角色构图不串位的关键。**方位不能自相矛盾**：一个动作只给一个终点方向（`down her cheek` 与 `toward her temple` 不能同时出现）。",
    "9. **动作对象用具体特征锚定**，禁止 she / he / her / his 指代（写 `the black-haired woman` 而非 `her`）。",
    "10. **画面里的文字用双引号原句**给出，并配合 speech bubble / thought bubble / typography 标签：例如 `text \"Are you done? I have to make a tiktok today\"`。",
    "11. **不要重复 tags 已明确的外观与服装**；description 只做增量（空间关系、光线质感、动作细节、画面文字）。实测最常见的浪费是「标签写了 nude，散文又写 naked / 裸」这类同义复述。",
    "12. **最后一句用来收束**：交代主光源、主体阴影或画面的定格感，不引入新信息。",
    "13. **画面里没有的东西不要写**；若必须交代「某人不在画面里」，用正面表述（out of frame / out of view / her face is not visible），不要写成「不要画某人」。",
    "14. **不要把观众写成画面的施动者**：POV 语义里 viewer = 摄影机/叙述者，不是画面里看不见的性行为对象（`under the viewer's thrusts` 这类写法会把观众变成角色）。画外男性写成 `a faceless man behind her`，并在 tags 里补 `1boy, faceless male, head out of frame`。",
    "15. **句首不要大写非专有名词**：句子被前置短语拼接后容易出现 `…, Kneeling on the bed, …` 这种句中大写。",
    "16. **单角色场景固定 2 句（第1层+第3层），多角色每角色第1层+共享第2层+第3层**；无必要信息不强行补全。（语料中位 3 句、约 80~100 词；把 3 句压到 2 句、把与 tags 重复的内容删掉，能省下约 25% 的 token 且几乎不损失画面信息）。",
    "17. 语法不必完美，**语义绑定准确优先于句法正确**（模型读的是词袋语义）；但主谓必须完整，否则会被误读成标签流水。",
];
// --------------------------------------------------
// 6. 多角色隔离（实测：30/80 条为多角色；总结出 6 类隔离手段）
// --------------------------------------------------
export const MULTI_CHARACTER_RULES = [
    "## 多角色（≥2 人）隔离",
    "- **特征物理相邻**：每个角色的所有描述（外观、服装、位置、姿态）写在一起，不要把 A 和 B 的属性交错排列。",
    "- **独占特征按区分度给**：优先用「发色+发长」「服装颜色/款式」「明确画面位置」「区分度高的姿态/交互」；年龄/肤色/瞳色/体型无出处不填，不强行凑齐。",
    "- **三人及以上必须给每个角色明确位置**：On the left / In the center / On the right，并把特征绑定到具体角色。",
    "- **共用特征提到最外层**（场景、风格、光影、全局动作），不要放角色块里。",
    "- **双人互动写成同时存在的静态关系**：如 \"A is gripping B's wrist, B leaning toward the door but looking back at A\"，不要写先后动作链。",
    "- **非焦点角色按可见性处理**（四种表达语义不同，不可互换）：",
    "    • faceless：角色无可见面部特征（可能生成无脸）",
    "    • head out of frame：头部在取景框外（适用于明确裁切构图）",
    "    • male face out of frame：男性面部不在画面内（需确认是否为期望构图）",
    "    • solo focus：强调单一主体焦点（不等于隐藏他人面部）",
    "  先确定非焦点角色在画面中应呈现什么，再用合理裁切/景深/构图表达；不要默认给所有非焦点人物加缺失面部表达。",
    "- **角色数量明确写出并在正文绑定位置**；仅在实测证明有效时，才针对特定场景重复数量表达（如 2girls + multiple boys）。"
];
// --------------------------------------------------
// 7. 矛盾对（实测：同一提示词内的高频冲突组合，审核阶段据此消解）
// --------------------------------------------------
export const CONFLICT_PAIRS = [
    ["expressionless", "blush / smile / ahegao", "表情自相矛盾：二选一，优先保留与正文一致的那个"],
    ["closed mouth", "open mouth", "嘴部状态矛盾：二选一"],
    ["looking away", "looking at viewer", "视线矛盾：二选一"],
    ["no bra / no panties", "bra / panties", "服装矛盾：二选一"],
    ["no lineart / no outline", "lineart / outline", "画风矛盾：二选一"],
    ["flat color", "gradient / 彩色渐变", "色彩矛盾：二选一（要「有质感的扁平」就只留 flat color + high contrast）"],
    ["monochrome", "vivid colors / colorful", "色彩矛盾：想兼顾就给两边不同权重，但不要无条件同时写"],
    ["solo / 1girl", "2girls / 3girls / multiple girls", "人数矛盾：人数标签与画面角色数必须一致"],
    ["close-up / waist up", "thighs / legs / feet / skirt / breasts", "景别与可见部位矛盾：按景别裁掉画面外部位"],
    ["from behind / profile", "looking at viewer", "朝向与视线矛盾：背对/侧对镜头时不要写正面视线（否则角色会强行回头）"],
];
// --------------------------------------------------
// 8. 审核要点（第二阶段用；按输入形态给不同基准）
// --------------------------------------------------
export const REVIEW_COMMON_CHECKS = [
    "**矛盾消解**（最高优先级）：同一提示词内互相打架的描述只留一个。常见矛盾对：",
    ...CONFLICT_PAIRS.map(([a, b, how]) => `  - ${a} × ${b} → ${how}`),
    "**顺序与格式**：标签段按「分级 → 人数 → 风格 → 外观 → 服装 → 表情视线 → 动作 → 镜头 → 环境 → 光影 → 文字音效」排列；不要为了美观重排已定型的分隔符风格。",
    "**权重合规**：权重总数 3~6 处；不给人数标签加权；风格类优先；弱化只用于明确排除项。",
    "**保留强调性重复**：同一标签重复 1~2 次是刻意的强调手段，不要当冗余删掉；只有语义完全相同的重复才删。",
    "**不要凭空补内容**：不得引入原文/输入里没有的角色、道具、颜色、材质；缺什么就留空，不要编。",
    "**长度**：明显超标且内容可删时才裁剪（具体口径见下方形态条目）。",
    "**多角色**：每位角色 ≥2 个互不相同的独占特征；特征物理相邻；非焦点角色加 faceless / out of frame 之类缺失标签。",
    "**最小改动**：只改被判定为违规的部分；没有被点名的标签、句子、顺序、措辞一个字都不动。不得顺手重排未点名的问题、不得改写未被指出的措辞、不得「优化」已经合规的写法。",
];
// --------------------------------------------------
// 8a. 混合模式审核基准
// --------------------------------------------------
export const REVIEW_MIXED_CHECKS = [
    "**混合形态**：审查对象是「Hard Tags 段 + Natural Language 段」两段结构 ——",
    "- 段序必须是 Hard Tags 在前、Natural Language 在后；不得颠倒。",
    "- 两段各自内部遵守对应形态的规范（标签段看标签规范，描述段看句子规范）。",
    "- 两段不得重复同一信息（描述段不重复标签段已给的外观与服装；镜头词不重复）。",
    "- 标签段：安全分级必须**恰好一个**且在**最前面**；同义标签不要堆成三连（nude+no bra+no panties / blindfold+black blindfold / bed+on bed+wooden bed 各自择一或择二）；同一体型维度不要堆不同向的词；不允许画师串与质量咒语。**角色数量标签不重复（multiple 类模糊词不重复）**。",
    "- 描述段：每句完整主谓、10~29 词、主动语态、现在时；禁代词指代（she/her）；禁无主语前置碎片串；禁把观众写成施动者；方位不能自相矛盾。**按三层结构组织：主体姿态 → 互动空间 → 镜头环境光影收束；无必要信息不补全**。",
    "- 画外人物在标签段有 1boy / faceless male / head out of frame；镜头词（cowboy shot / from above / centered composition）落在标签层。",
    "- **降噪**：两段之间同一信息只写一次；标签段删掉语料 0 次的稀有词（white light / overhead lighting / closed curtains / furrowed brow / sagging breasts / low ponytail / centered composition，肤色写 fair skin 而不是 pale skin）；描述段删掉与标签段重复的外观/服装复述。",
    "- **数量**：标签段单角色 20~28 个、多角色 30~40 个；描述段单角色 2 句、多角色每角色一句。只在明显超标且可删时才裁剪。",
    `- 长度口径：标签段单角色 ${LENGTH_BUDGETS.single.tags} 个标签、多角色 ${LENGTH_BUDGETS.multi.tags} 个标签；描述段单角色 2 句（复杂场景 3 句）、多角色 3~5 句。`,
];
// --------------------------------------------------
// 8b. tags 模式专用：极简 description 增量规范
// --------------------------------------------------
export const TAGS_MODE_DESCRIPTION_RULES = [
    "## tags 模式下的 description 字段（可选，极简增量）",
    "- **仅当标签无法表达时**输出 1-2 个**短语片段**（非完整句、无主谓、以逗号分隔）。",
    "- 允许内容：空间位置、光影质感、动作状态、画面文字。",
    "- 禁止内容：身份/外观/服装/数量/镜头参数（这些全在 tags）。",
    "- 示例：`between his knees, warm lamplight from left, text \"Help me\"`",
    "- **不加句号**，插件渲染时直接追加在 tags 段后，用 `, ` 连接。",
];
// --------------------------------------------------
// 8c. description 模式专用：三层结构 + 隐性字段一致性
// --------------------------------------------------
export const DESCRIPTION_MODE_RULES = [
    "## description 模式下的三层结构与隐性字段一致性",
    "- **必须按三层结构写 2-3 句**：",
    "  ① 主体身份+核心外观+静态姿态+视线",
    "  ② 其他角色位置/特征+交互关系+空间层级",
    "  ③ 关键镜头/环境锚点+主光源阴影收束",
    "- **隐性结构化字段一致性（必须填写，供程序校正）**：",
    "  * optics.distance：句子中的可见部位不得违背此景别裁剪（close-up 不写下半身等）",
    "  * optics.cameraAngle / composition：句子中的镜头描述须与此一致",
    "  * optics.focusTarget / depthOfField：焦点描述须与此一致",
    "  * mainSubject/secondarySubjects：身份/外观/姿态/位置锚点，供程序生成人数标签与裁剪",
    "- **身份/外观/数量信息密度控制**：不要在句子里罗列发色/瞳色/服装细节，用「the black-haired woman in uniform」类指代短语代替。",
    "- 示例：",
    "  A black-haired woman in a school uniform kneels on the bed, gripping the wrist of a faceless man behind her.",
    "  He leans over her from above, his erection straining against a chastity belt locked at his crotch.",
    "  Dim bedroom light from the window catches the metal gleam, shadows stretching across rumpled sheets.",
];
// --------------------------------------------------
// 8d. Review 基准增强：tags 模式
// --------------------------------------------------
export const REVIEW_TAGS_CHECKS = [
    "**纯标签形态**：审查对象是空格分隔的 Danbooru 标签序列 ——",
    "- 逐 token 检查：全小写、无标点、一个概念一个 token（多词用空格，如 black hair）。",
    "- 不允许出现句子、句号、逗号流水。",
    "- 不允许出现画师串（@artist）与质量咒语（masterpiece / best quality / absurdres / very aesthetic）。",
    "- 不允许臆造词：只保留 Danbooru 真实存在的标签形态。",
    "- 安全分级必须**恰好一个**且在**标签段最前面**；其后是人数/性别标签。",
    "- 同义标签不要堆成三连（nude + no bra + no panties / blindfold + black blindfold / bed + on bed + wooden bed 各自择一或择二）；同一体型维度不要堆不同向的词（large breasts × sagging breasts × muscular thighs）。",
    "- 画外人物要有标签（1boy + faceless male + head out of frame）；镜头词（cowboy shot / from above / centered composition）应出现在标签层。",
    "- 需要补充内容时，补充**也必须是标签**，不能写成句子。",
    "- **降噪**：一个信息只写一次；删掉语料 0 次的稀有词（white light / overhead lighting / closed curtains / furrowed brow / sagging breasts / low ponytail / centered composition，肤色写 fair skin 而不是 pale skin）；删掉与自然语言段重复的同义复述；删掉被否定的元素（写了 nude 就不再写 no bra / no panties）。",
    `- **标签数量**：单角色 20~28 个，多角色 30~40 个；宁可少写也不要堆。只在明显超标且可删时才裁剪。`,
    `- 长度口径：单角色 ${LENGTH_BUDGETS.single.chars} 字符 / ${LENGTH_BUDGETS.single.tags} 个标签；多角色 ${LENGTH_BUDGETS.multi.chars} 字符 / ${LENGTH_BUDGETS.multi.tags} 个标签。`,
    "",
    "**tags 模式下的 description 增量（若存在）**：",
    "- 必须是短语片段（非完整句、无主谓、以逗号分隔），仅含空间/光影/动作状态/文字。",
    "- **不含**身份/外观/服装/数量/镜头参数。",
    "- 不加句号，渲染时直接追加在 tags 段后。",
    "",
    "**Tags 内同义归一（强制执行）**：",
    "- pov + male pov → pov",
    "- chastity belt + leather belt + copper lock → chastity belt",
    "- silk pajama top + unbuttoned + open clothes → silk pajama top, unbuttoned",
    "- silk pajama pants + pajama pants → silk pajama pants",
    "- 合并后保留 1 条，删除其余。",
    "",
    "**非焦点角色缺失标签语义单选（强制执行）**：",
    "- faceless / head out of frame / male face out of frame / solo focus 四选一，严禁组合。",
    "- 有身体在画面 → 仅 faceless；明确裁切构图 → 仅 head out of frame；仅弱化权重 → 不用缺失标签改用景深/构图。",
];
// --------------------------------------------------
// 8e. Review 基准增强：description 模式
// --------------------------------------------------
export const REVIEW_DESCRIPTION_CHECKS = [
    "**自然语言形态**：审查对象是逗号分隔的英文句子 ——",
    "- 逐句检查：完整主谓结构、现在时、主动语态、10~29 词、句末有句号。",
    "- 代词指代要换成具体特征锚定（she → the black-haired woman）。",
    "- 方位关系缺失要补（谁在上/下/左/右）；**方位不能自相矛盾**（down 与 toward 不能同时给终点）。",
    "- **禁止无主语的前置碎片串**（`in a cowboy shot, from a high angle, in a centered composition,`）—— 镜头词要么在标签层，要么写成完整句（`A high-angle shot of …` / `The camera angle is from below, …`）。",
    "- **禁止把观众写成施动者**（`the viewer's thrusts`）—— 画外人物写 `a faceless man behind her`，并确保标签层有对应的 1boy / faceless male / head out of frame。",
    "- 主体自身的状态不要用被动（`is tied over her eyes` 会凭空引入「谁系的」）。",
    "- 与标签段重复的外观/服装（同义复述）要删掉；句子过长（>29 词）要拆句。",
    "- 画面文字必须是双引号原句。",
    "- 需要补充内容时，补充**必须是句子**，不能写成标签流水。",
    "- **降噪**：一个信息只写一次；删掉与标签段重复的外观/服装同义复述；删掉语料 0 次的稀有词（white light / overhead lighting / closed curtains / furrowed brow / centered composition）。",
    "- **散文长度**：单角色 2 句、40~50 词；多角色每角色一句。只在明显超标且可删时才裁剪。",
    `- 长度口径：单角色 ${LENGTH_BUDGETS.single.chars} 字符 / 2 句（复杂场景 3 句）；多角色 ${LENGTH_BUDGETS.multi.chars} 字符 / 3~5 句（每角色一句）。`,
    "",
    "**三层结构强制（强制执行）**：",
    "- 必须按三层写 2-3 句：① 主体身份+核心外观+静态姿态+视线 ② 其他角色位置/特征+交互关系+空间层级 ③ 关键镜头/环境锚点+主光源阴影收束。",
    "- **无必要信息不补全**。",
    "",
    "**隐性结构化字段一致性（强制执行）**：",
    "- 句子中的景别描述必须与 optics.distance 一致；可见部位不得违背 distance 裁剪规则。",
    "- 句子中的镜头描述必须与 optics.cameraAngle / composition 一致。",
    "- 句子中的焦点描述必须与 optics.focusTarget / depthOfField 一致。",
    "- mainSubject/secondarySubjects 提供的身份/外观/姿态/位置锚点，供程序生成人数标签与景别裁剪。",
    "",
    "**身份/外观/数量信息密度控制（强制执行）**：",
    "- 不要在句子里罗列发色/瞳色/服装细节（这些本应在 tags），用「the black-haired woman in uniform」类指代短语代替。",
    "",
    "**Few-shot 示例（必须遵循的修改风格）**：",
    "",
    "### 输入",
    "A beautiful girl with long black hair and blue eyes wearing a white school uniform stands in a classroom looking at the viewer with a smile, cinematic lighting, depth of field.",
    "",
    "### notes",
    "[三层结构] 重组为三层：① 主体姿态 ② 互动空间 ③ 环境光影收束",
    "[密度控制] 删除了外观罗列：long black hair/blue eyes/white school uniform → 改为指代短语",
    "[隐性字段] optics.distance=cowboy shot 与句子可见部位一致",
    "",
    "### 输出 prompt",
    "A black-haired girl in uniform stands at cowboy-shot distance, her gaze fixed on the viewer with a faint smile.",
    "Morning light slants through tall windows, catching dust motes and the edge of her jaw, shadows pooling behind empty desks.",
];
// --------------------------------------------------
// 9. 审核阶段的**动作骨架**（三形态共用）
// --------------------------------------------------
export const REVIEW_ACTION_LINES = [
    "**只改命中的**：notes 里判定为「命中」的要点才允许动提示词；判定为「未命中」或「不适用」的内容一个字都不改。",
    "**先 notes 后 prompt**：JSON 里 notes 字段必须写在 prompt 字段之前 —— 判定先落盘，再写修订稿，避免边想边改。",
    "**不要重新创作**：不得因为「写得不够好」而重写、扩写、润色未被点名的部分；不得补充输入里没有的信息。",
    "**格式不得变动**：段数、段序、段内分隔符、安全分级、人数标签、镜头词位置一律保持原样（除非该条本身就是审查要点）。",
    "**notes 写法**：命中的要点每写一行，格式为「〔要点名〕命中 → 改了什么」；一条都没命中就写一行「未命中任何要点 → 保持原样」。notes 不得为空。",
];
/**
 * 探测送审提示词的形态。
 * 判定依据：
 *   - 含 \nBREAK\n 分段 → 两段 → mixed（标签段在前、描述段在后）
 *   - 整串没有任何句点 → 纯标签
 *   - 否则按句读 → description
 */
export function detectPromptShape(prompt) {
    const p = String(prompt ?? "").trim();
    if (!p)
        return "description";
    const sections = p.split(/\nBREAK\n/).map(s => s.trim()).filter(Boolean);
    if (sections.length >= 2)
        return "mixed";
    // 有句点且句点后有空格+字母 → 句子
    if (/[.!?]\s+[A-Za-z]/.test(p))
        return "description";
    if (/\.$/.test(p) && p.split(/\s+/).length > 3)
        return "description";
    return "tags";
}
