import { callLLM, type CallLLMOptions } from "./api.js";

export type RegexRuleType = "custom" | "extract" | "exclude" | "exclude_before" | "exclude_after";

export interface RegexRule {
  name: string;
  pattern: string;
  replacement: string;
  enabled: boolean;
  type?: RegexRuleType;
  startTag?: string;
  endTag?: string;
  tag?: string;
}

export interface PromptTag {
  name: string;
  prompt: string;
  enabled: boolean;
}

export interface ExtractedTagGroup {
  category: string;
  tags: string[];
}

export interface TextCleaningConfig {
  floorCount: number;
  rules: RegexRule[];
  truncateDirection: "top" | "bottom";
  truncatePercent: number;
  truncateMode?: "percent" | "chars";
  truncateChars?: number;
  truncateTolerance?: number;
}

export function getTextCleaningConfig(s: Record<string, unknown>): TextCleaningConfig {
  return {
    floorCount: (s.floor_count as number) ?? 1,
    rules: (s.regex_rules as RegexRule[]) ?? [],
    truncateDirection: (s.truncate_direction as "top" | "bottom") ?? "top",
    truncatePercent: (s.truncate_percent as number) ?? 100,
    truncateMode: (s.truncate_mode as "percent" | "chars") ?? "percent",
    truncateChars: (s.truncate_chars as number) ?? 2000,
    truncateTolerance: (s.truncate_tolerance as number) ?? 100,
  };
}

const DANGEROUS_REGEX = /\([^)]*[+*?][^)]*\)\s*[+*?]/;

function isDangerousRegex(pattern: string): boolean {
  return DANGEROUS_REGEX.test(pattern);
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function processTagRule(text: string, rule: RegexRule): string {
  if (!rule.enabled) return text;
  
  const type = rule.type ?? "custom";
  
  if (type === "custom") {
    if (!rule.pattern) return text;
    if (isDangerousRegex(rule.pattern)) {
      console.warn(`[image_st] Skipping dangerous regex rule "${rule.name || "unnamed"}": ${rule.pattern}`);
      return text;
    }
    try {
      const regex = new RegExp(rule.pattern, "g");
      return text.replaceAll(regex, rule.replacement ?? "");
    } catch {
      return text;
    }
  }
  
  const startTag = rule.startTag?.trim();
  const endTag = rule.endTag?.trim();
  const tag = rule.tag?.trim();
  
  if (type === "extract" || type === "exclude") {
    if (!startTag || !endTag) return text;
    const startEscaped = escapeRegExp(startTag);
    const endEscaped = escapeRegExp(endTag);
    const regex = new RegExp(`${startEscaped}[\\s\\S]*?${endEscaped}`, "g");
    
    if (type === "extract") {
      const matches: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const content = match[0].slice(startTag.length, -endTag.length);
        matches.push(content);
      }
      return matches.join("\n");
    } else {
      return text.replaceAll(regex, "");
    }
  }
  
  if (type === "exclude_before" || type === "exclude_after") {
    if (!tag) return text;
    const tagEscaped = escapeRegExp(tag);
    const regex = new RegExp(tagEscaped);
    const match = regex.exec(text);
    if (!match) return text;
    
    const index = match.index;
    if (type === "exclude_before") {
      return text.substring(index + tag.length);
    } else {
      return text.substring(0, index);
    }
  }
  
  return text;
}

function cleanChatContent(text: string, rules: RegexRule[]): string {
  let result = text;
  for (const rule of rules) {
    result = processTagRule(result, rule);
  }
  return result;
}

function extractAssistantMessages(
  messages: Array<{ mes?: string; is_user?: boolean }>,
  count: number
): string {
  const result: string[] = [];
  let found = 0;
  for (let i = messages.length - 1; i >= 0 && found < count; i--) {
    const m = messages[i];
    // Fix: is_user can be undefined in old format; treat undefined as assistant
    if (m.is_user !== true && m.mes) {
      result.push(m.mes);
      found++;
    }
  }
  result.reverse();
  return result.join("\n\n");
}

function truncateByPercent(
  text: string,
  direction: "top" | "bottom",
  percent: number
): string {
  if (percent >= 100 || !text) return text;
  const p = Math.max(1, Math.min(100, percent));
  const ends: number[] = [];
  const regex = /[。.!！?？]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    ends.push(match.index + match[0].length);
  }
  if (ends.length === 0) return text;
  if (direction === "top") {
    const targetLen = Math.floor(text.length * p / 100);
    let best = 0;
    for (const pos of ends) {
      if (pos <= targetLen) best = pos;
      else break;
    }
    return text.substring(0, best);
  } else {
    const cutStart = Math.floor(text.length * (100 - p) / 100);
    let best = text.length;
    for (const pos of ends) {
      if (pos >= cutStart) { best = pos; break; }
    }
    return text.substring(best);
  }
}

function truncateByChars(
  text: string,
  direction: "top" | "bottom",
  targetChars: number,
  tolerance = 100
): string {
  if (!text || targetChars >= text.length) return text;
  
  const minLen = Math.max(0, targetChars - tolerance);
  const maxLen = targetChars + tolerance;
  
  const boundaries: number[] = [0];
  const paraRegex = /\n\n|[。.!！?？]\s*\n/g;
  let match: RegExpExecArray | null;
  while ((match = paraRegex.exec(text)) !== null) {
    boundaries.push(match.index + match[0].length);
  }
  boundaries.push(text.length);
  
  if (direction === "top") {
    let best = 0;
    for (const pos of boundaries) {
      if (pos >= minLen && pos <= maxLen) best = pos;
      else if (pos > maxLen) break;
    }
    return best ? text.substring(0, best) : text.substring(0, Math.min(maxLen, text.length));
  } else {
    let best = text.length;
    for (let i = boundaries.length - 1; i >= 0; i--) {
      const pos = boundaries[i];
      const len = text.length - pos;
      if (len >= minLen && len <= maxLen) { best = pos; break; }
      if (len > maxLen) break;
    }
    return text.substring(best);
  }
}

export function extractTagsFromText(text: string): ExtractedTagGroup[] {
  const groups: Map<string, Set<string>> = new Map();
  
  // 1. 变量标签行：<image_N>'tag1', 'tag2', ...
  const varTagRegex = /<image_\d+>([^<]+)/g;
  let match: RegExpExecArray | null;
  const varTags = new Set<string>();
  while ((match = varTagRegex.exec(text)) !== null) {
    const content = match[1];
    const tagMatches = content.match(/'([^']+)'/g);
    if (tagMatches) {
      for (const tm of tagMatches) {
        // 保留单引号
        varTags.add(tm.trim());
      }
    }
  }
  if (varTags.size) groups.set("var_tag", varTags);
  
  // 2. 成对标签：括号格式 (xxx)...(/xxx) - 提取完整标签含括号
  const pairBracketRegex = /\(([^()<>]+)\)[\s\S]*?\(\/\1\)/g;
  const pairTags = new Set<string>();
  while ((match = pairBracketRegex.exec(text)) !== null) {
    // 完整开始标签: (xxx), 完整结束标签: (/xxx)
    pairTags.add(`(${match[1].trim()})`);
    pairTags.add(`(/${match[1].trim()})`);
  }
  
  // 3. 成对标签：XML格式 <xxx>...</xxx> - 提取完整标签含尖括号
  const pairXmlRegex = /<([^()<>]+)>[\s\S]*?<\/\1>/g;
  while ((match = pairXmlRegex.exec(text)) !== null) {
    pairTags.add(`<${match[1].trim()}>`);
    pairTags.add(`</${match[1].trim()}>`);
  }
  if (pairTags.size) groups.set("pair_tag", pairTags);
  
  // 4. 大括号格式 {xxx}...{/xxx}
  const pairBraceRegex = /\{([^{}<>]+)\}[\s\S]*?\{\/\1\}/g;
  while ((match = pairBraceRegex.exec(text)) !== null) {
    pairTags.add(`{${match[1].trim()}}`);
    pairTags.add(`{/${match[1].trim()}}`);
  }
  if (pairTags.size) groups.set("pair_tag", pairTags);
  
  // 5. 单独出现的标签（括号/尖括号/大括号） - 提取完整标签含符号
  const singleTagRegex = /[(<{]([^()<>]+)[)>}]/g;
  const singleTags = new Set<string>();
  while ((match = singleTagRegex.exec(text)) !== null) {
    const tag = match[1].trim();
    const wrapper = match[0][0]; // 获取包裹符号
    const closer = match[0][match[0].length - 1];
    if (tag && !tag.startsWith("/")) {
      singleTags.add(`${wrapper}${tag}${closer}`);
    }
  }
  if (singleTags.size) groups.set("single_tag", singleTags);
  
  // 转换为结果
  const categoryMap = {
    var_tag: "变量标签",
    pair_tag: "成对标签块",
    single_tag: "单标记",
  };
  
  return Array.from(groups.entries()).map(([key, tags]) => ({
    category: categoryMap[key as keyof typeof categoryMap] || key,
    tags: Array.from(tags).sort()
  }));
}

export function processTextPipeline(
  messages: Array<{ mes?: string; is_user?: boolean }>,
  config: TextCleaningConfig
): string {
  let text = extractAssistantMessages(messages, config.floorCount);
  if (config.rules.length > 0) {
    text = cleanChatContent(text, config.rules);
  }
  const mode = config.truncateMode ?? "percent";
  if (mode === "chars") {
    const targetChars = config.truncateChars ?? 2000;
    const tolerance = config.truncateTolerance ?? 100;
    text = truncateByChars(text, config.truncateDirection, targetChars, tolerance);
  } else {
    if (config.truncatePercent < 100) {
      text = truncateByPercent(text, config.truncateDirection, config.truncatePercent);
    }
  }
  return text;
}

export async function generateLLMPrompt(
  chatContent: string,
  apiKey: string,
  systemPrompt = "",
  llmUrl?: string,
  model?: string,
  signal?: AbortSignal,
  maxTokens = 0,
  reasoningEffort?: string,
  temperature?: number,
  top_p?: number,
  thinkingBudget?: number,
  jsonMode = false,
  useApiProfile = false,
  apiProfile?: { apiKey: string; url: string; model: string }
): Promise<string> {
  if (!chatContent) return "";
  
  const finalApiKey = useApiProfile && apiProfile ? apiProfile.apiKey : apiKey;
  const finalUrl = useApiProfile && apiProfile ? apiProfile.url : llmUrl;
  const finalModel = useApiProfile && apiProfile ? apiProfile.model : model;
  
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [];
  if (systemPrompt.trim()) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: chatContent });

  const options: CallLLMOptions = {
    messages,
    apiKey: finalApiKey,
    url: finalUrl,
    model: finalModel,
    maxTokens,
    signal,
    reasoningEffort,
    temperature,
    top_p,
    thinkingBudget,
    jsonMode,
  };
  return await callLLM(options);
}