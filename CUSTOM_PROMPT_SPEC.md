# 完全自定义模式 提示词格式规范

## 概述
- 模式标识：`custom`
- 行为：用户在提示词编辑框填写的内容，**原样发送给 LLM**，LLM 返回的内容**原样作为最终 prompt 送入生图管线**
- 插件**不做任何后处理、格式化、拼接、校验、契约追加**
- 仅在 LLM 调用失败、解析失败、生图失败时抛出错误信息

---

## 用户提示词（发送给 LLM 的内容）

### 由用户完全自定
- 在「生成管线」tab → 「解析模式」选 `完全自定义` 时，下方编辑框即为完整系统提示词
- 支持任意文本、Markdown、XML 标签、<thinking>/<json> 等任意格式
- 插件**不注入**任何固定层规范、契约块、POV 段、多角色隔离规范
- 插件**不追加**标签候选清单

### 占位符（可选使用）
| 占位符 | 替换内容 |
|--------|----------|
| `{pov}` | `POV` 或 `第三人称` |
| `{narrator}` | 叙述者名（POV 时） |
| `{nsfw}` | 空串（已弃用） |

---

## LLM 返回内容（作为最终 prompt）

### 接受格式（任选其一）
1. **纯文本 prompt**（推荐最简） —— 直接送 ComfyUI
2. **JSON 对象**（标准结构化输出，推荐生产用） —— 插件提取 `prompt` 字段
   ```json
   { "prompt": "explicit, 1girl, solo, black hair, long hair, blue eyes, school uniform, looking at viewer, cowboy shot, depth of field, bedroom, soft lighting\nBREAK\nA black-haired girl in uniform kneels on the bed, gazing at the viewer. Morning light slants through the window, catching dust motes." }
   ```
3. **带 <thinking> 的 JSON** —— 同第 2 种，插件自动剥离 `<thinking>...</thinking>`
   ```
   <thinking>分析过程...</thinking>
   <json>{ "prompt": "...", "notes": "..." }</json>
   ```

### JSON 字段规范
| 字段 | 必填 | 说明 |
|------|------|------|
| `prompt` | ✅ | 完整最终 prompt 字符串（含 `\nBREAK\n` 分段） |
| `notes` | 可选 | 给用户/调试用的说明，不送生图 |

### 解析失败处理
- 无法解析 JSON → 将原始返回文本整体作为 prompt（不报错）
- 返回为空 → 报错「LLM 返回空内容」

---

## 推荐的系统提示词模板（复制到编辑框即用）

```text
你是 AI 图像提示词工程师。从小说片段锁定一个单一静态画面，输出结构化 JSON。

# 输出格式契约（强制）
只输出**一个 JSON 对象**，不要输出解释文字、不要用 Markdown 代码块包裹。
**输出格式：必须先输出 <thinking>…</thinking>，再输出 <json>…</json>**，中间不得有其他文字。
<json> 标签内必须是合法 JSON：无注释、无尾随逗号、无 Markdown 围栏。

# 字段定义
"prompt": "完整最终提示词（Hard Tags 段在前，Natural Language 段在后，用 \\nBREAK\\n 分隔；标签逗号分隔、全小写、多词用空格；句子完整主谓、现在时、主动语态）"
"notes": "可选说明"

# 关键要求
- 必含安全分级 (safe/sensitive/nsfw/explicit) + 人数标签 (1girl/solo/2girls...)
- Hard Tags 顺序：分级→人数→风格→外观→服装→表情视线→动作→镜头→环境→光影→文字
- 不写画师串、质量咒语、负面词、中文
- 自然语言段只写标签写不了的东西（空间关系/光影质感/动作状态/画面文字）
```

### 解析失败处理
- 无法解析 JSON → 将原始返回文本整体作为 prompt（不报错）
- 返回为空 → 报错「LLM 返回空内容」

---

## 最终 Prompt 格式建议（自负）

> 插件不强制，但以下格式与下游生图模型兼容性最好：

### 推荐：双段 Anima Hybrid 格式
```
explicit, 1girl, solo, black hair, long hair, blue eyes, school uniform, looking at viewer, cowboy shot, depth of field, bedroom, soft lighting
BREAK
A black-haired girl in uniform kneels on the bed, gazing at the viewer. Morning light slants through the window, catching dust motes.
```
- Hard Tags 段：逗号分隔、全小写、多词用空格、含安全分级+人数标签
- Natural Language 段：完整英文句子、现在时、主动语态
- 两段用 `\nBREAK\n` 分隔

### 兼容：纯标签串
```
explicit, 1girl, solo, black hair, long hair, blue eyes, school uniform, looking at viewer, cowboy shot, bedroom, soft lighting
```

### 兼容：纯自然语言
```
A black-haired girl in uniform kneels on the bed, gazing at the viewer. Morning light slants through the window, catching dust motes.
```

---

## 必须包含的关键要素（自查清单）

| 要素 | 缺失后果 |
|------|----------|
| 安全分级 `safe/sensitive/nsfw/explicit` | ComfyUI workflow 可能报错或生成不符合预期分级 |
| 人数标签 `1girl/1boy/solo/2girls...` | 易出现多人/无人/错位 |
| 主体外观标签（发色/瞳色/服装等） | 主体特征不可控 |
| 景别标签 `close-up/waist up/cowboy shot/full body/wide shot` | 构图不可控 |

---

## 禁忌（插件不拦截，但会导致出图异常）

| 禁忌 | 说明 |
|------|------|
| 画师串 `@artist` | 污染风格，版权风险 |
| 质量咒语 `masterpiece/best quality/absurdres/score_9` | 挤占 token、画风漂移 |
| 负面提示词 `negative prompt / don't / no` | 正面 prompt 不应含负面 |
| 中文/全角标点 | 会被阶段8兜底剔除，导致 prompt 截断 |
| 权重语法 `(tag:1.3)` 超过 10 处 | 维护成本极高，易失控 |

---

## 错误反馈机制

| 失败点 | 错误信息示例 |
|--------|--------------|
| LLM 调用失败 | `LLM 调用失败: 401 Unauthorized` |
| LLM 返回空 | `LLM 返回空内容` |
| JSON 解析失败 | 已兜底：原始文本作为 prompt（不报错） |
| 生图失败 | `ComfyUI 生成失败: ...` |

---

## 快速测试建议

1. **最小可行 Prompt**：只写核心标签 `explicit, 1girl, solo, black hair, school uniform`
2. **逐步加项**：每次只加 1 类（景别 → 光影 → 环境 → 细节），观察出图变化
3. **对照基线**：同一随机种子下，对比 `mixed` 模式与 `custom` 模式出图差异
4. **利用变体**：开启 `gen_variants: ["custom", "mixed"]` 一次生成多版本对比

---

## 与其它模式的区别

| 特性 | `mixed` | `description` | `tags` | `custom` |
|------|---------|---------------|--------|----------|
| 系统提示词 | 内置+用户可改 | 内置+用户可改 | 内置+用户可改 | **仅用户自定** |
| 契约块追加 | ✅ | ✅ | ✅ | ❌ |
| 固定层规范注入 | ✅ | ✅ | ✅ | ❌ |
| LLM 输出约束 | JSON+固定字段 | JSON+固定字段 | JSON+固定字段 | **任意** |
| 后处理管线 | 完整走 | 完整走 | 完整走 | **旁路直通** |
| 适用场景 | 标准生产 | 纯描述微调 | 纯标签微调 | **极致实验/对照/极简** |