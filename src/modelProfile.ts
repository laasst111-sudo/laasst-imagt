// ============================================================
// modelProfile.ts —— 按「模型家族」适配 LLM 请求参数
// ------------------------------------------------------------
// 背景：image-st 主要面向硅基流动（SiliconFlow，OpenAI 兼容 Chat
// Completions），其上同时托管 GLM / Kimi / Qwen / DeepSeek 等不同
// 家族的模型。它们在「思考模式/思维链」开关、思考预算、上下文长度
// 的参数形态上并不相同：
//   - Qwen3     : enable_thinking(bool) + thinking_budget(int)（顶层）
//   - GLM 4.x   : thinking{type:"enabled"/"disabled"[, budget_tokens]} 对象
//   - Kimi K2   : enable_thinking(bool) + thinking_budget(int)（顶层）
//   - DeepSeek  : thinking{type:...} + reasoning_effort + extra_body.thinking_budget
// 因此不再用「URL 字符串猜测网关」，改为按「模型名判断家族」精确生成参数。
// ============================================================

export type ModelFamily = 'qwen' | 'glm' | 'kimi' | 'deepseek' | 'nemotron' | 'generic';

// 上一版本沿用的 effort 映射（low/medium → high，xhigh → max）
const EFFORT_MAP: Record<string, string> = { low: 'high', medium: 'high', xhigh: 'max' };

/** 归一化思考强度：返回 undefined 表示不思考 */
export function normalizeEffort(effort?: string): string | undefined {
  if (!effort || effort === 'none') return undefined;
  return EFFORT_MAP[effort] ?? effort;
}

/** 识别模型家族（优先于 URL 猜测） */
export function detectModelFamily(model: string): ModelFamily {
  const m = (model ?? '').toLowerCase();
  if (m.includes('qwen')) return 'qwen';
  if (m.includes('glm') || m.includes('chatglm') || m.includes('zai-org') || m.includes('zhipu') || m.includes('cogview')) return 'glm';
  if (m.includes('kimi') || m.includes('moonshot')) return 'kimi';
  if (m.includes('deepseek')) return 'deepseek';
  if (m.includes('nemotron')) return 'nemotron';
  return 'generic';
}

/** 该家族是否原生支持「思考/思维链」开关 */
export function familySupportsThinking(family: ModelFamily): boolean {
  return family === 'qwen' || family === 'glm' || family === 'kimi' || family === 'deepseek' || family === 'nemotron';
}

// ------------------------------------------------------------
// v2.6：DeepSeek 的**两家网关参数形态不同**（实测文档核对）
// ------------------------------------------------------------
// DeepSeek 官方 API（api.deepseek.com，模型 `deepseek-flash`）：
//   思考开关 {"thinking":{"type":"enabled|disabled"}}（顶层）+ reasoning_effort: low/high/max
//   思考模式下 temperature / top_p / presence_penalty / frequency_penalty **不生效**
//   max_tokens **包含**思维链预算（思考与答案共用）
//   评分词 effort 走原生 1~100 滑杆（low=50 / high=75 / max=100），不吃固定 token 预算
//
// 硅基流动（api.siliconflow.cn，模型 `deepseek-ai/DeepSeek-V4.1-Flash`）：
//   思考开关 `enable_thinking`(bool, 顶层) + `thinking_budget`(int, 128~32768, 顶层)
//   reasoning_effort 只接受 "high" | "max"（low/medium 会被映射到 high）
//   max_tokens **不含**思维链（思维链由 thinking_budget 单独限）
//
// 此前插件对 deepseek 家族只发官方形态（thinking 对象）→ 在硅基流动上：
//   ① 「关思考」发 `thinking:{type:'disabled'}` 被网关忽略 → 思考其实没关；
//   ② thinking_budget 被塞进 `extra_body`（那是 OpenAI SDK 的包装字段，裸 HTTP 里网关读不到）。
// → 下面按 URL 判定网关，分别用各自正确的字段形态。
// ------------------------------------------------------------

export type LlmGateway = "siliconflow" | "deepseek" | "generic";

/** 按请求 URL 判定网关（只影响「思考字段形态」的选择） */
export function detectGateway(url?: string): LlmGateway {
  const u = (url ?? "").toLowerCase();
  if (u.includes("siliconflow.cn") || u.includes("siliconflow.com")) return "siliconflow";
  if (u.includes("api.deepseek.com")) return "deepseek";
  return "generic";
}

// ------------------------------------------------------------
// GLM 细分能力（v2.1，修复硅基流动 GLM-5.3 思考强度选项失效）
// 依据 z.ai 官方文档（Deep Thinking / GLM-5.3 / GLM-5.2）与
// 硅基流动 GLM-5.3 发布公告（api.siliconflow.cn，zai-org/GLM-5.3）：
//   - GLM-5.3 / 5.3-FLASH：强制思考模型。thinking.type 仅接受 enabled
//     （传 disabled 会被拒绝/报错）；唯一强度控制是 reasoning_effort，
//     仅支持 low / high / max（其它取值报错，模型默认 max）。
//     官方迁移指引：原 thinking.type:"disabled" 应改为 enabled + reasoning_effort:"low"。
//   - GLM-5.2：thinking 可开关；支持 reasoning_effort
//     （max/xhigh/high/medium/low/minimal/none，none/minimal 表示不思考）。
//   - 其余 GLM（4.x / 5 / 5.1 / Z1）：维持 thinking 对象开关，不变。
// ------------------------------------------------------------

/** GLM-5.3 系列（含 FLASH 变体）：强制思考，thinking.type 不接受 disabled，由 reasoning_effort 控制强度 */
export function isGLMForcedThinking(model: string): boolean {
  const m = (model ?? '').toLowerCase();
  return /glm[\s_-]*5\.3(?!\d)/.test(m);
}

/** GLM-5.2：可开关思考，且支持 reasoning_effort 强度控制 */
function isGLM52(model: string): boolean {
  const m = (model ?? '').toLowerCase();
  return /glm[\s_-]*5\.2(?!\d)/.test(m);
}

/** GLM-5.3 合法 reasoning_effort 仅有 low/high/max。
 *  插件选项映射（对齐 z.ai 官方值域）：none/minimal/low→low；medium/high→high；xhigh/max→max；未知值兜底 low。 */
function glm53Effort(raw?: string): 'low' | 'high' | 'max' {
  const v = (raw ?? 'none').toLowerCase();
  if (v === 'max' || v === 'xhigh') return 'max';
  if (v === 'high' || v === 'medium') return 'high';
  return 'low';
}

// ------------------------------------------------------------
// 上下文窗口登记表（按模型名特征精确匹配，先具体后通用）
// 单位：token。取不到精确匹配时回退到家族默认值。
// ------------------------------------------------------------
const CONTEXT_WINDOWS: Array<{ re: RegExp; tokens: number }> = [
  { re: /qwen3.*(\b|\/)(235b|a3b)/i, tokens: 131072 },
  { re: /qwen3.*coder/i, tokens: 131072 },
  { re: /qwen2\.5-(72b|32b)/i, tokens: 131072 },
  { re: /qwen3/i, tokens: 32768 },
  { re: /qwen/i, tokens: 32768 },
  { re: /glm/i, tokens: 131072 },
  { re: /kimi/i, tokens: 262144 },
  { re: /deepseek.*(r1|v3)/i, tokens: 131072 },
  { re: /deepseek/i, tokens: 65536 },
  { re: /nemotron.*ultra/i, tokens: 131072 },
  { re: /nemotron/i, tokens: 131072 },
];

const FAMILY_DEFAULT_CONTEXT: Record<ModelFamily, number> = {
  qwen: 32768,
  glm: 131072,
  kimi: 262144,
  deepseek: 65536,
  nemotron: 131072,
  generic: 32768,
};

/** 获取模型上下文长度（token） */
export function getModelContextLength(model: string): number {
  const m = (model ?? '').toLowerCase();
  for (const rule of CONTEXT_WINDOWS) {
    if (rule.re.test(m)) return rule.tokens;
  }
  return FAMILY_DEFAULT_CONTEXT[detectModelFamily(model)] ?? 32768;
}

/**
 * 计算安全的 max_tokens：不为负、且不超过上下文窗口（留出输入占比）。
 * - requested<=0：使用默认值（1024）
 * - requested>上下文*0.8：钳制到上下文*0.8，避免超出窗口
 */
export function clampMaxTokens(requested: number, contextLength: number): number {
  const effective = requested > 0 ? requested : 1024;
  const cap = Math.floor(contextLength * 0.8);
  return Math.max(1, Math.min(effective, cap));
}

// ------------------------------------------------------------
// 思考字段构造器 —— 按家族生成正确的思考/预算字段
// ------------------------------------------------------------
interface BuildInput {
    model: string;
    reasoningEffort?: string;
    thinkingBudget?: number;
    /** v2.6：网关形态（决定 DeepSeek 的思考字段长什么样） */
    gateway?: LlmGateway;
}

/** 返回需要并入请求 body 的字段 */
export function buildThinkingFields(input: BuildInput): Record<string, unknown> {
  const family = detectModelFamily(input.model);
  const effort = normalizeEffort(input.reasoningEffort);
  const thinkingOn = familySupportsThinking(family) && !!effort;
  const budget = input.thinkingBudget && input.thinkingBudget > 0 ? input.thinkingBudget : 0;

  const fields: Record<string, unknown> = {};

  switch (family) {
    case 'qwen':
      // Qwen3：enable_thinking + thinking_budget（顶层参数）
      fields.enable_thinking = thinkingOn;
      if (budget > 0) fields.thinking_budget = budget;
      break;

    case 'glm':
      // v2.1: GLM 细分 —— 5.3 系强制思考（仅 reasoning_effort 控强度）；
      // 5.2 可开关且支持 reasoning_effort；其余（4.x/5/5.1/Z1）维持 thinking 对象。
      if (isGLMForcedThinking(input.model)) {
        // GLM-5.3 / 5.3-FLASH：无法关闭思考（thinking.type 传 disabled 会被网关拒绝）。
        // “Non-think”按官方迁移指引映射为最低强度 reasoning_effort:"low"。
        // 该模型无预算参数，budget 字段不发送。
        fields.thinking = { type: 'enabled' };
        fields.reasoning_effort = glm53Effort(input.reasoningEffort);
      } else if (isGLM52(input.model)) {
        // GLM-5.2：thinking 可开关；开启时强度经 reasoning_effort 控制（budget 不适用）
        if (thinkingOn) {
          fields.thinking = { type: 'enabled' };
          if (effort) fields.reasoning_effort = effort;
        } else {
          fields.thinking = { type: 'disabled' };
        }
      } else if (thinkingOn) {
        // GLM 4.x / 5 / 5.1 / Z1：thinking 对象（可选 budget_tokens）
        fields.thinking = budget > 0
          ? { type: 'enabled', budget_tokens: budget }
          : { type: 'enabled' };
      } else {
        fields.thinking = { type: 'disabled' };
      }
      break;

    case 'kimi':
      // Kimi K2：enable_thinking + thinking_budget（顶层）
      fields.enable_thinking = thinkingOn;
      if (budget > 0) fields.thinking_budget = budget;
      break;

case 'deepseek':
        // DeepSeek：thinking 对象 + reasoning_effort + extra_body.thinking_budget
        // v2.6：按网关分形态 ——
        //   官方 API：{"thinking":{"type":"enabled|disabled"}} + reasoning_effort
        //             （思考预算不适用：V4.1-Flash 用原生 1~100 effort 滑杆）
        //   硅基流动：enable_thinking(bool) + thinking_budget(int, 顶层) + reasoning_effort
        if (input.gateway === 'siliconflow') {
            fields.enable_thinking = thinkingOn;
            if (thinkingOn && budget > 0) fields.thinking_budget = budget;
            if (thinkingOn) fields.reasoning_effort = effort;
        } else if (thinkingOn) {
            fields.thinking = { type: 'enabled' };
            fields.reasoning_effort = effort;
            if (budget > 0) fields.extra_body = { thinking_budget: budget };
        } else {
            fields.thinking = { type: 'disabled' };
        }
        break;

    case 'nemotron':
        // Nemotron 3 Ultra：通过 extra_body.chat_template_kwargs 控制思考（NVIDIA 原生 API）
        // enable_thinking: boolean - 开关思考
        // medium_effort: boolean - 中等强度（少 token）
        // reasoning_budget: number - 思考 token 预算
        // OpenRouter 兼容：使用标准 reasoning 参数
        if (thinkingOn) {
            const chatTemplateKwargs: Record<string, unknown> = { enable_thinking: true };
            // effort 映射：none/low -> 不设置（默认全强度）；medium -> medium_effort=true；high/max -> 全强度（不设置 medium_effort）
            const normalizedEffort = normalizeEffort(input.reasoningEffort);
            if (normalizedEffort === 'medium') {
                chatTemplateKwargs.medium_effort = true;
            }
            if (budget > 0) {
                chatTemplateKwargs.reasoning_budget = budget;
            }
            fields.extra_body = { chat_template_kwargs: chatTemplateKwargs };
            // OpenRouter 等标准网关使用 reasoning 参数
            if (input.gateway !== 'siliconflow' && input.gateway !== 'deepseek') {
                fields.reasoning = { effort: normalizedEffort ?? 'high' };
            }
        } else {
            // 关闭思考：NVIDIA 原生 API 用 chat_template_kwargs；OpenRouter 用 reasoning.effort="none"
            fields.extra_body = { chat_template_kwargs: { enable_thinking: false } };
            if (input.gateway !== 'siliconflow' && input.gateway !== 'deepseek') {
                fields.reasoning = { effort: 'none' };
            }
        }
        break;

    default:
      // generic —— 未知家族不做任何思考控制（避免未知字段被 OpenAI 兼容网关 400）
      break;
  }

  return fields;
}
