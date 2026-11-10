# ST Image Plugin Gen2 — UI 架构说明

> 基于代码库全面分析，涵盖所有 UI 组件、事件流与源文件职责。

---

## 一、整体 UI 层次结构

```
SillyTavern 左侧扩展面板 (extensions_settings)
  └─ inline-drawer 容器 (#image_st_settings)
       ├─ inline-drawer-header（始终可见）
       │    ├─ 标题 "ST Image Plugin Gen2"
       │    ├─ Generate Image 按钮 (#image_st_generate)
       │    └─ 展开/收起箭头
       │
       ├─ 生成结果区域 (#image_st_result)
       │
       ├─ 标签栏 (#image_st_tab_bar)
       │    ├─ 基础设置 (data-tab="basic")
       │    ├─ 文本清洗 (data-tab="text-cleaning")
       │    ├─ LLM配置  (data-tab="llm")
       │    ├─ ComfyUI配置 (data-tab="comfy")  ← 默认激活
       │    └─ 角色库   (data-tab="charlib")
       │
       └─ 5 个标签页内容区 (.image-st-tab-content)

运行时 UI（独立于设置面板）:
  ├─ 悬浮生成按钮 (#image_st_floating_div)
  ├─ 行内进度指示器 (.image-st-inline-progress)
  └─ 图片显示定位 (CSS 类注入 .mes_media_wrapper)
```

---

## 二、标签页 UI 结构与功能

### Tab 1: 基础设置 (basic)

```
┌─ 基础设置 ──────────────────────────────────────────────────┐
│ ☐ 自动生成（角色回复后自动生成，30秒冷却）                     │
│ ☐ 显示悬浮生成按钮（可拖拽移动）                              │
│ ☐ 显示生成进度                                               │
│ ──────────────────────────────────────────────────────────── │
│ [📋 复制图片目录]  提示: user/images/{角色名}/                │
│ ──────────────────────────────────────────────────────────── │
│ 图片显示设置                                                  │
│ 对齐方式: [偏左 | 居中* | 偏右]                               │
│ 图片大小:  [小(300px) | 中(500px)* | 大(全宽)]                │
│ ──────────────────────────────────────────────────────────── │
│ ☐ 悬浮按钮显示生成进度动画                                    │
│   提示: 生成中图标变为旋转动画+脉冲光晕                        │
│ ──────────────────────────────────────────────────────────── │
│ ☐ 发送请求前剥离图片（纯文本后端兼容）                         │
│ ──────────────────────────────────────────────────────────── │
│ 图片定位                                                      │
│ 锚定文本: [输入框]（为空时不定位）                             │
│ 图片位置: [锚点上方* | 锚点下方]                               │
└──────────────────────────────────────────────────────────────┘
```

**功能列表:**

| 控件 ID | 类型 | 绑定设置键 | 功能描述 |
|---|---|---|---|
| `image_st_auto_generate` | checkbox | `auto_generate_enabled` | 角色回复后自动触发图片生成，30秒冷却防抖 |
| `image_st_floating_btn` | checkbox | `floating_btn_enabled` | 显示/隐藏悬浮生成按钮，即时创建或销毁 |
| `image_st_progress_enabled` | checkbox | `progress_enabled` | 启用/禁用 toastr 进度通知 |
| `image_st_copy_gallery_path` | button | — | 复制 `user/images/{角色名}/` 到剪贴板 |
| `image_st_image_align` | select | `image_align` | 图片水平对齐（left/center/right） |
| `image_st_image_size` | select | `image_size` | 图片最大宽度（small:300px / medium:500px / large:100%） |
| `image_st_progress_in_chat` | checkbox | `progress_in_chat` | 悬浮按钮在生成时显示旋转+脉冲动画 |
| `image_st_strip_inline_media` | checkbox | `strip_inline_media` | 发送LLM前剥离多模态内容（纯文本后端兼容） |
| `image_st_anchor_text` | input | `anchor_text` | 锚定文本，图片据此前插或后插，最长200字符 |
| `image_st_anchor_position` | select | `anchor_position` | 锚定相对位置（above/below） |

---

### Tab 2: 文本清洗 (text-cleaning)

```
┌─ 文本清洗 ──────────────────────────────────────────────────┐
│ 楼层提取数量: [══●═══════] [1] (1~5 滑块+数字)               │
│ ──────────────────────────────────────────────────────────── │
│ 正则清洗规则                        [+ 添加规则]              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ [名称]  [正则模式]         [替换文本]  ☑ 启用  [✕]      │ │
│ │ [名称]  [正则模式]         [替换文本]  ☐ 启用  [✕]      │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ──────────────────────────────────────────────────────────── │
│ 字数限制                                                      │
│ 截取方向: [从上往下截取* | 从下往上截取]                      │
│ 截取长度: [══●═══════════] [100] (1~100, 100=关闭)           │
│ ──────────────────────────────────────────────────────────── │
│ 文本清洗测试工具 (0 字符)                                      │
│ [▶ 执行测试]                                                  │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ (只读文本框，显示清洗结果)                                 │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**功能列表:**

| 控件 ID | 类型 | 绑定设置键 | 功能描述 |
|---|---|---|---|
| `image_st_floor_count` | slider+number | `floor_count` | 从末尾提取 N 条助手消息（1-5） |
| `image_st_add_regex_rule` | button | — | 追加一条空的正则规则到 `regex_rules[]` |
| `#image_st_regex_rules_container` | DOM容器 | `regex_rules[]` | 动态渲染每条规则：名称/正则/替换文本/启用/删除 |
| `image_st_truncate_direction` | select | `truncate_direction` | 截取方向（top=从头保留 / bottom=从尾保留） |
| `image_st_truncate_percent` | slider+number | `truncate_percent` | 保留百分比（100=不截断） |
| `image_st_test_cleaning` | button | — | 执行整条文本清洗管线，结果写入只读文本框 |
| `image_st_test_cleaning_result` | textarea(readonly) | — | 显示清洗测试结果 + 字符计数 |

**清洗管线流程:**

```
原始消息 → 楼层提取(取末尾 N 条) → 正则替换(按 `regex_rules[]` 顺序依次执行) → 截断(按百分比+句子边界) → 输出
```

---

### Tab 3: LLM 配置 (llm)

```
┌─ LLM 配置 ──────────────────────────────────────────────────┐
│ API Key:        [••••••••••••••••••••]                       │
│ LLM API URL:    [https://api.siliconflow.cn/v1/...]          │
│ LLM 模型:       [Qwen/Qwen2.5-7B-Instruct]                   │
│ Temperature:    [══●═══════════] [1.0] (0~2)                  │
│ Top P:          [══●═══════════] [1.0] (0~1)                  │
│ ──────────────────────────────────────────────────────────── │
│ 思考模式: [Non-think* | Think High | Think Max]               │
│   提示: 思考模式下 Temperature 与 Top P 不会生效              │
│ Thinking Budget: [══●════════════════] [0] (0=模型默认, 1-80000)│
│ 最大输出 Token: [512] (0=不限制)                              │
│ ──────────────────────────────────────────────────────────── │
│ ☐ 启用 JSON 格式清洗（LLM 返回 JSON 时自动提取纯净 prompt）   │
│ ☐ 转换为小写英文字母                                          │
│ ☐ 删除中文字符                                                │
│ ──────────────────────────────────────────────────────────── │
│ [🔌 测试连接]  ● 状态灯  连接成功 (123ms)                    │
│ ──────────────────────────────────────────────────────────── │
│ 系统提示词 (1289 字符)                                        │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ (多行文本框，默认 5 模块系统提示词)                       │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**功能列表:**

| 控件 ID | 类型 | 绑定设置键 | 功能描述 |
|---|---|---|---|
| `image_st_api_key` | password | `apiKey` | LLM API 密钥 |
| `image_st_llm_url` | input | `llm_url` | LLM API 端点 URL（默认 SiliconFlow） |
| `image_st_llm_model` | input | `llm_model` | 模型名称（默认 Qwen2.5-7B-Instruct） |
| `image_st_llm_temperature` | slider+number | `llm_temperature` | 温度参数 0-2 |
| `image_st_llm_top_p` | slider+number | `llm_top_p` | 核采样参数 0-1 |
| `image_st_llm_reasoning_effort` | select | `llm_reasoning_effort` | 思考模式: none/high/max |
| `image_st_llm_max_tokens` | number | `llm_max_tokens` | 最大输出 Token（建议 512-1024） |
| `image_st_thinking_budget` | number | `thinking_budget` | Thinking Budget（0=使用模型默认，仅 Qwen3 等支持） |
| `image_st_json_clean_enabled` | checkbox | `json_clean_enabled` | 启用 JSON 格式清洗（LLM 返回 JSON 时自动提取纯净 prompt） |
| `image_st_lowercase_enabled` | checkbox | `lowercase_enabled` | 将 LLM 返回的提示词中大写英文字母转为小写 |
| `image_st_strip_chinese_enabled` | checkbox | `strip_chinese_enabled` | 删除 prompt 中的中文残留字符 |
| `image_st_test_llm` | button | — | 测试 LLM 连接（15s 超时，显示状态灯+耗时） |
| `image_st_llm_system_prompt` | textarea | `llm_system_prompt` | 系统提示词（实时字符计数） |

---

### Tab 4: ComfyUI 配置 (comfy) — 默认激活

```
┌─ ComfyUI 配置 ───────────────────────────────────────────────┐
│ [🔌 测试连接]  ● 状态灯  连接成功 (234ms)                    │
│ ComfyUI URL: [http://127.0.0.1:8188]                        │
│ 基础模型: [animav6.0.safetensors ▼] [🔄 刷新]               │
│   内置工作流: Anima正式版-文生图工作流.json                    │
│ ──────────────────────────────────────────────────────────── │
│ 采样设置                                                      │
│ 总采样步数:      [══●════] [30] (1~150)                      │
│ 首次采样步数:    [15] (0=关闭二次采样)                        │
│ ┌─ 首次采样参数 ────────────────────────────────────────────┐│
│ │ CFG:       [══●════] [7.0] (1~30)       (首次步数>0时显示)││
│ │ 采样器:    [euler ▼]  调度器: [normal ▼]                  ││
│ └──────────────────────────────────────────────────────────┘│
│ 二次采样参数                                                   │
│ CFG:       [══●════] [7.0]                                   │
│ 采样器:    [euler ▼]  调度器: [normal ▼]                     │
│ ──────────────────────────────────────────────────────────── │
│ 提示词设置                                                     │
│ 固定正面-前缀: [textarea 多行]                                 │
│ 固定正面-后缀: [textarea 多行]                                 │
│ ──────────────────────────────────────────────────────────── │
│ 自定义提示词标签                 [🏷️ 添加标签]               │
│ ☑ 启用自定义提示词标签                                        │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ [标签名称]  ☑ 启用  [✕]                                  │ │
│ │ [textarea 提示词内容]                                     │ │
│ └──────────────────────────────────────────────────────────┘ │
│ 多个标签以 ", " 连接附加到固定正面提示词之后                    │
│ ──────────────────────────────────────────────────────────── │
│ 负面提示词: [textarea 多行]                                   │
│ ──────────────────────────────────────────────────────────── │
│ LoRA 设置                                                     │
│ ┌─ LoRA 1 ─────────────────────────────────────────────────┐ │
│ │ LoRA 1: [▼ 选择模型]  [仅首次 ▼]                         │ │
│ │ 首次: [1.0]  二次: [1.0]                                 │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌─ LoRA 2~4 (同上) ────────────────────────────────────────┐ │
│ ──────────────────────────────────────────────────────────── │
│ Seed: [-1] (-1=随机)                                         │
│ Width: [══●════] [1024]   Height: [══●════] [1024]          │
└──────────────────────────────────────────────────────────────┘
```

**功能列表:**

| 控件 ID | 类型 | 绑定设置键 | 功能描述 |
|---|---|---|---|
| `image_st_test_comfy` | button | — | 测试 ComfyUI 连接（10s 超时） |
| `image_st_comfy_url` | input | `comfy_url` | ComfyUI 地址（默认 http://127.0.0.1:8188） |
| `image_st_model` | select | `model` | 基础 Checkpoint 模型（从 ComfyUI 实时拉取列表） |
| `image_st_refresh_models` | button | — | 刷新模型和 LoRA 下拉列表 |
| `image_st_steps` | slider+number | `steps` | 总采样步数 1-150 |
| `image_st_first_steps` | number | `first_steps` | 首次采样步数（0=关闭二次采样） |
| `image_st_first_cfg` | slider+number | `first_cfg` | 首次 CFG 1-30（first_steps>0 时可见） |
| `image_st_first_sampler` | select | `first_sampler` | 首次采样器（从完整列表选择） |
| `image_st_first_scheduler` | select | `first_scheduler` | 首次调度器（从完整列表选择） |
| `image_st_second_cfg` | slider+number | `second_cfg` | 二次 CFG 1-30 |
| `image_st_second_sampler` | select | `second_sampler` | 二次采样器 |
| `image_st_second_scheduler` | select | `second_scheduler` | 二次调度器 |
| `image_st_fixed_prefix` | textarea | `fixed_prompt_prefix` | 固定正面提示词前缀 |
| `image_st_fixed_suffix` | textarea | `fixed_prompt_suffix` | 固定正面提示词后缀 |
| `image_st_prompt_tags_enabled` | checkbox | `prompt_tags_enabled` | 启用自定义提示词标签 |
| `image_st_add_prompt_tag` | button | — | 添加自定义提示词标签 |
| `#image_st_prompt_tags_container` | DOM容器 | `prompt_tags[]` | 标签列表：名称/启用/提示词内容/删除 |
| `image_st_negative_prompt` | textarea | `negative_prompt` | 负面提示词 |
| `#image_st_lora_container` | DOM容器 | `lora_slots[]` | 4 个 LoRA 插槽：名称/模式(v4)/首次强度(v4)/二次强度(v4) |
| `image_st_seed` | number | `seed` | 随机种子（-1=随机） |
| `image_st_width` | slider+number | `width` | 图片宽度 64-2048（步长8） |
| `image_st_height` | slider+number | `height` | 图片高度 64-2048（步长8） |

---

### Tab 5: 角色库 (charlib)

```
┌─ 角色库 ─────────────────────────────────────────────────────┐
│ MVU 角色库                                                     │
│ ☑ 启用 MVU 角色库集成                                         │
│ MVU 状态：已就绪 (1248 B, 数据来自最新) · 已选 12 项（含 2 条通配）│
│ ⚠ 3 条已选在当前卡的变量结构中不存在 [查看] [一键清除]         │
│ ┌───────────────────────────────────────────────────────────┐ │
│ │ [搜索变量名/路径…]       [⤵展开] [⤴收起] [🌲加载MVU树]  │ │
│ └───────────────────────────────────────────────────────────┘ │
│ ┌─ 已选 chips ──────────────────────────────────────────────┐ │
│ │ [清空全部] [char.name #1 ✕] [char.昵称 ∅ ✕] [人物.*.年龄]│ │
│ └───────────────────────────────────────────────────────────┘ │
│ ┌─ MVU 树 (max-height:400px, 可滚动) ──────────────────────┐ │
│ │ ▶ ☐ char                                                   │ │
│ │   ▶ ☐ name [📋]  ─ "张三"                                 │ │
│ │   ▶ ☐ title [📋] ─ "法师"                                 │ │
│ │   ▶ ☑ 人物 (3) [📋] [⊞矩阵]                              │ │
│ │     ├─ ☑ 张无忌 [📋]                                       │ │
│ │     │  ├─ ☑ 年龄 [📋]                                      │ │
│ │     │  ├─ ☑ 功法 [📋]  ─ "九阳神功"                         │ │
│ │     │  └─ ☑ 势力 [📋]  ─ "明教" (对象字段:▸对象)           │ │
│ │     └─ ☑ 赵敏 [📋]                                         │ │
│ │        └─ ☑ 年龄 [📋]                                      │ │
│ │ ── 字段矩阵视图 ──                                         │ │
│ │ ┌─────────┬──────┬──────┬──────┐                           │ │
│ │ │ 人物(2) │ ☑年龄│ □功法│ □势力│                           │ │
│ │ ├─────────┼──────┼──────┼──────┤                          │ │
│ │ │ 张无忌  │ ☑    │ ☑    │ ☑    │                          │ │
│ │ │ 赵敏    │ ☑    │ □    │ □    │                          │ │
│ │ └─────────┴──────┴──────┴──────┘                          │ │
│ └───────────────────────────────────────────────────────────┘ │
│ 提示：勾选任意节点后，其数据在生成时注入 LLM；                │
│ 分支 checkbox 支持一键全选/取消全部子孙。                      │
│ ──────────────────────────────────────────────────────────── │
│ 神·数据库                                                      │
│ ☑ 启用数据库信息源                                            │
│ 数据库状态：已就绪 (3 表 / 45 行) · 已选 2 表 / 8 字段       │
│ [🔍 扫描数据库]                                               │
│ ┌─ 已选 chips ──────────────────────────────────────────────┐ │
│ │ [清空全部] [人物信息表 (4 字段) ✕] [物品表 (4 字段) ✕]    │ │
│ └───────────────────────────────────────────────────────────┘ │
│ [搜索表名/字段…]       [⤵展开] [⤴收起]                       │
│ ┌─ 数据库树 ────────────────────────────────────────────────┐ │
│ │ ▶ ☑ 人物信息表 (12 字段)                                  │ │
│ │     ├─ ☑ name [📋]                                        │ │
│ │     ├─ ☑ age  [📋]                                        │ │
│ │     └─ ...                                                │ │
│ │ ▶ □ 物品表 (8 字段)                                       │ │
│ └───────────────────────────────────────────────────────────┘ │
│ 提示：表级 checkbox 一键全选/取消该表所有字段。                │
 │ ──────────────────────────────────────────────────────────── │
 │ 注入段顺序                                                      │
 │ 信息段排列顺序: [角色信息 → 正文 (默认) | 正文 → 角色信息]      │
 │ 提示：控制角色信息（MVU / 数据库）与正文在 LLM 输入中的排列顺序。│
 │ ──────────────────────────────────────────────────────────── │
 │ 注入预览                                                       │
│ [👁️ 预览注入结果]                                            │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ (只读文本框，与发送至 LLM 的内容完全一致)                  │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**功能列表:**

| 控件 ID | 类型 | 绑定设置键 | 功能描述 |
|---|---|---|---|
| `image_st_mvu_enabled` | checkbox | `mvu_enabled` | 启用/禁用 MVU 角色库集成 |
| `#image_st_mvu_status` | text | — | 状态汇总：已就绪/不可用/大小/数据来源/已选数量/通配/失效 |
| `#image_st_mvu_invalid` | bar | — | 失效已选提示条（"查看"滚动到 chips，"一键清除"批量删除） |
| `image_st_mvu_search` | input | — | 按路径末段名实时过滤 MVU 树节点 |
| `image_st_mvu_expand_all` | click | — | 展开 MVU 树全部节点 |
| `image_st_mvu_collapse_all` | click | — | 收起 MVU 树全部节点 |
| `image_st_mvu_load_tree` | button | — | 调用 `buildMvuTree()` 渲染 MVU 树 |
| `#image_st_mvu_selected` | chips容器 | `mvu_selections[]` | 已选路径 chips：定位/名段切换/删除 |
| `#image_st_mvu_tree` | 递归树容器 | — | 三态级联 MVU 树 + 字段矩阵视图 |
| `image_st_db_enabled` | checkbox | `db_enabled` | 启用/禁用数据库信息源 |
| `#image_st_db_status` | text | — | 状态汇总：已就绪/表数/行数/已选 |
| `image_st_db_scan` | button | — | 调用 `rebuildDatabaseTableTree()` 扫描渲染数据库树 |
| `#image_st_db_selected` | chips容器 | `db_selection[]` | 已选表+字段数的 chips |
| `image_st_db_search` | input | — | 按表名/字段名实时过滤数据库树 |
| `image_st_db_expand_all` | click | — | 展开数据库树全部 |
| `image_st_db_collapse_all` | click | — | 收起数据库树全部 |
| `#image_st_db_tree` | 递归树容器 | `db_selection[]` | 数据库表+字段三态级联树 |
| `image_st_injection_order` | select | `injection_order` | 段排列顺序：`info_first`=角色信息前置 / `body_first`=正文前置 |
| `image_st_preview_injection` | button | — | 执行 `previewInjectionPipeline()` 预览完整 LLM 输入 |
| `image_st_preview_result` | textarea(readonly) | — | 预览结果 + 字符计数 |

---

## 三、运行时 UI 系统

### 3.1 悬浮生成按钮 (#image_st_floating_div)

- **DOM 位置**: `document.body` 直接子元素
- **图标**: `fa-solid fa-magic`（空闲）/ `fa-spinner fa-spin-pulse`（生成中）/ `fa-check`（完成）/ `fa-xmark`（失败）
- **拖拽**: 鼠标/触摸事件驱动，`localStorage` 持久化位置（`image_st_floating_pos_v2`）
- **区域限制**: `clampFloatingPos()` 限制在视口内
- **点击策略**: 拖拽距离 < 5px 视为点击 → 触发 `onGenerate()`；否则视为拖拽
- **阶段动画**: `image-st-animate-pulse` 脉冲光晕 + `fa-spin-pulse` 旋转

### 3.2 行内进度指示器

- 在最后一条消息 `.mes_text` 后创建 `<div class="image-st-inline-progress">`
- 每秒更新：`生成中 (NN秒)` 显示在消息内
- 生成完成后自动移除；失败时 also removed in `finally` block

### 3.3 图片显示系统

- **保存**: `saveBase64AsFile()` → `user/images/{角色名}/{角色名}_{timestamp}.{format}`
- **附加**: `appendMediaToMessage()` 用 ST API 附加到消息的 `extra.media[]`
- **对齐**: `.image-st-align-{left/center/right}` → `justify-content`
- **大小**: `.image-st-size-{small/medium/large}` → `max-width: 300px/500px/100%`
- **锚点**: `applyAnchorPosition()` 在锚定文本上方/下方插入媒体元素（数据层原文匹配，5次重试，100ms 间隔）

### 3.4 进度状态机

```
idle
  │
  ▼ (onGenerate 开始)
prompting ──► toastr.info "🖋 正在生成提示词…" + 悬浮按钮脉冲动画
  │
  ▼ (LLM 返回)
rendering ──► toastr.info "🎨 正在渲染图片…" + 悬浮按钮脉冲动画加速
  │
  ├──► done ──► toastr.success + 悬浮按钮✓图标 ──► 3秒后自动 reset → idle
  │
  └──► failed ──► toastr.error + 悬浮按钮✕图标 ──► 3秒后自动 reset → idle
```

- 生成耗时测量（`GenTiming`）：提示词生成 / 图片渲染 / 总耗时
- 5 分钟超时提醒定时器（每 5 分钟 toastr 提醒）
- 1 秒进度更新定时器（resultDiv + 悬浮按钮 title + 行内进度）

---

## 四、事件绑定总图

```
createSettingsUI() 初始化阶段:
  ├─ 所有 input/select/textarea 的 change 事件 → saveSettingsDebounced()
  ├─ linkSlider() 绑定 9 组 slider↔number 双向同步
  ├─ 生成按钮 click → onGenerate()
  ├─ 测试 LLM 连接 → testLLMConnection() (15s超时)
  ├─ 测试 ComfyUI 连接 → testComfyUIConnection() (10s超时)
  ├─ 正则添加 → s.regex_rules.push() + rebuildRegexRulesUI()
  ├─ 正则删除 → s.regex_rules.splice() + rebuildRegexRulesUI()
  ├─ 标签添加 → s.prompt_tags.push() + rebuildPromptTagsUI()
  ├─ 标签删除 → s.prompt_tags.splice() + rebuildPromptTagsUI()
  ├─ 模型刷新 → populateModelDropdown() + populateLoraDropdowns()
  ├─ 文本清洗测试 → onTestTextCleaning()
  ├─ 复制图片目录 → onCopyGalleryPath()
  ├─ MVU 启用切换 → refreshMvuData() / clearMvuCache() + UI更新
  ├─ DB 启用切换 → refreshDatabaseData() / clearDatabaseCache() + UI更新
  ├─ MVU load tree → renderMvuTree()
  ├─ MVU 搜索 → 实时过滤 + 自动展开祖先 + 高亮
  ├─ MVU 展开/收起 → setAllTreeExpanded()
  ├─ DB scan → rebuildDatabaseTableTree()
  ├─ DB 搜索 → 实时过滤 + 自动展开祖先 + 高亮
  ├─ DB 展开/收起 → setDbTreeExpanded()
  ├─ 预览注入 → getPreview() (index.ts 注入的回调)
  ├─ 思考模式切换 → 显示/隐藏 temperature/top_p 不生效提示
  ├─ 首次步数切换 → 显示/隐藏首次采样参数区块
  ├─ 锚点文本 change → 最长200字符校验
  ├─ iOS focusin → 居中滚动适配键盘
  └─ CHAT_CHANGED → 清除 MVU/DB 缓存 + 重新加载

悬浮按钮独立事件:
  ├─ mousedown / touchstart → 开始拖拽
  ├─ mousemove / touchmove → 拖拽移动
  ├─ mouseup / touchend → 停止拖拽 + 持久化位置 + 检测点击
  └─ click → 非拖拽时触发 onGenerate()

全局事件 (index.ts 注册):
  ├─ CHAT_COMPLETION_PROMPT_READY → stripInlineMediaFromChat()
  └─ GENERATION_ENDED → handleAutoGenerate() (30s冷却)
```

---

## 五、源文件与职责边界

| 文件 | 行数 | 职责 | 不可越界 |
|---|---|---|---|---|
| `settings.html` | 365 | Handlebars 模板——纯 UI 骨架 | 不含任何 JS 逻辑/事件 |
| `src/index.ts` | 563 | 入口协调器——生成流程编排 / 设置初始化 / 生命周期 / 段顺序排序 | 不得直接操作 DOM（除设置相关外） |
| `src/ui.ts` | 2201 | 全部 DOM 渲染与交互——设置面板 / 进度系统 / 浮动按钮 / 树渲染 / 连接测试 | 不得反向导入 index.ts（通过回调注入） |
| `src/api.ts` | 190 | LLM API 通信——流式请求 / 超时控制 / 缓存命中检测 | 不涉及 UI |
| `src/comfy.ts` | 313 | ComfyUI 集成——工作流管理 / 请求提交 / 状态轮询 | 不涉及 UI |
| `src/prompt.ts` | 238 | 提示词引擎——系统提示词 / 文本清洗管线 / LLM 调用封装 | 纯逻辑层 |
| `src/characterLib.ts` | 398 | MVU 角色库——数据获取 / 缓存 / 树构建 / 选择展开与名段匹配 / 注入多行格式化 | 数据层，不操作 DOM |
| `src/databaseLib.ts` | 272 | 数据库信息源——表扫描 / 字段选择 / 注入格式化 / 姓名检测 | 数据层，不操作 DOM |
| `src/nameMatcher.ts` | 135 | 中文姓名匹配——别名映射 / 复姓识别 / 称谓裁剪 | 纯工具函数 |

**依赖方向:**

```
index.ts ──导入──► ui.ts / api.ts / comfy.ts / prompt.ts / characterLib.ts / databaseLib.ts
                          └─► nameMatcher.ts (被 charLib 和 dbLib 引用)
```

严格单向依赖——`ui.ts` 不得导入 `index.ts`，所有回调（`onGenerate` / `getPreview`）由 `index.ts` 在 `createSettingsUI()` 时注入。
