// ============================================================
// v1.9 工作流优化：结构化 JSON → 确定性规则引擎 → 多行 prompt
// 移植自「（测试）工作流优化」server.js + optics.js
// 零依赖 · 纯函数 · 数据表驱动：改规则 = 改下方数据表
// ============================================================

// 注意：这里用 .ts 扩展名导入（TS 5.7+ 的 rewriteRelativeImportExtensions）。
// 原因：prompt_quality_test.mjs 直接 `import "./src/promptBuilder.ts"`（Node 类型剥离），
// Node 不会把 "./x.js" 解析成 "./x.ts"；用 .ts 扩展名两边都能跑，
// 且 emit 时 tsc 会自动改写成 "./x.js"。
import {
    CORPUS_VOCAB_LINES,
    DESCRIPTION_MODE_RULES,
    DESCRIPTION_SYNTAX_RULES,
    LENGTH_BUDGET_LINES,
    LENGTH_BUDGET_LINES_DESC,
    MULTI_CHARACTER_RULES,
    OUTPUT_SELF_CHECK,
    PRECISION_LINES,
    PROMPT_OUTPUT_EXCLUSIONS,
    PROSE_VOCAB_LINES,
    TAG_ORDER_LINES,
    TAG_SYNTAX_RULES,
    TAG_WEIGHT_RULES,
    TAGS_MODE_DESCRIPTION_RULES,
} from "./promptGuidelines.ts";
import { type ExtractMode } from "./pipeline.ts";
import { enforceSexWithExclusivity } from "./deterministicCorrections.ts";
import { toHalfWidth } from "./promptPost.ts";

// --------------------------------------------------
// 类型定义
// --------------------------------------------------

export type Gender = 'female' | 'male';

export interface SubjectInput {
  age?: number;
  gender?: Gender;
  /**
   * 非人类种族/生物标签（orc / elf / kitsune / dragon / wolf 等小写英文）：
   * 并入主语头 → "A green-skinned orc man"，抑制非人角色被画成人的幻觉。
   * 人类角色一律不填。种族独有肤色写 skin（green skin），种族特征（tusks/horns/tail）写 body/face。
   */
  species?: string;
  pose?: string;
  spatial?: string;
  hair?: string;
  eyes?: string;
  skin?: string;
  /** 身材/体型特征（仅原文有依据时写，如 large breasts） */
  body?: string;
  face?: string;
  clothing?: string;
  action?: string;
  /**
   * 交合标记（由 LLM 判定，仅当该角色阴茎/阴道与异性性器官发生插入、即本角色是插入方时填写）：
   * 引擎输出时方向由角色自身 gender 决定（male → "sex with woman"；female → "sex with he"），
   * 故值本身只作「是否插入」标志，填 'woman' 或 'he' 均可，方向以 gender 为准。
   * 一幅画面至多一名角色填；被插入方与未插入角色不填。
   */
  sexWith?: 'woman' | 'he';
}

export interface PovHandsInput {
  action?: string;
  anchor?: string;
}

export interface OpticsInput {
  // 人物朝向（按角色分别填写，仅单人非POV有效；多角色在各自 subject 里通过 spatial/pose 体现）
  subjectDirection?: 'front' | 'profile' | 'three-quarter' | 'back';
  // 相机视角（全局）
  cameraAngle?: 'front view' | 'over shoulder' | 'from above' | 'from below' | 'from side';
  // 景别（互斥单选）
  distance?: 'close-up' | 'waist up' | 'cowboy shot' | 'full body' | 'wide shot';
  // 焦点目标
  focusTarget?: 'subject' | 'face' | 'eyes' | 'crotch' | 'feet' | 'hands' | 'custom';
  // 景深表现
  depthOfField?: 'sharp focus' | 'deep focus' | 'depth of field' | 'blurry background';
  // 构图
  composition?: 'centered composition' | 'rule of thirds' | 'symmetrical composition' | 'golden ratio' | 'dutch angle' | 'sideways' | 'upside-down';
  // 透视
  perspective?: 'vanishing point' | 'atmospheric perspective' | 'panorama' | 'forced perspective' | 'perspective distortion' | 'extreme foreshortening';
  // 整体场景意图（仅供程序内部使用，不直接生成标签）
  intent?: 'pressure' | 'cute' | 'lonely' | 'intimate' | 'symmetric' | 'action' | 'cinematic';
}

export interface SummaryInput {
  scene?: string;
  light?: string;
}

export interface ExtractionInput {
    mainSubject: SubjectInput;
    secondarySubjects?: SubjectInput[];
    /** v2.2：LLM 直出的自然语言画面描述（可选；缺失时由规则引擎组装） */
    description?: string;
    /** v2.2：LLM 直出的 Danbooru 标签数组（可选；缺失时由词典分解产出） */
    tags?: string[];
    povHands?: PovHandsInput;
  /** POV 场景叙述者出镜的身体部位（英文 tag，如 pov from male, pov crotch, penis, penetration），性行为等需露出生殖器时输出 */
  povBody?: string;
  summary?: SummaryInput;
  setting?: string;
  lighting?: string;
  /** v3.x 环境整句（LLM 直接产出，如 "dim dressing room: half-drawn privacy curtain, warm lamplight from above"，无 A 前缀、可带冒号与细节，输出原样加句号结尾） */
  environment?: string;
  optics?: OpticsInput;
  /** 由前置代码判定覆盖，LLM 不输出 */
  isPovScene?: boolean;
}

export interface BuildResult {
  prompt: string;
  warnings: string[];
}

export interface PovInfo {
  isPov: boolean;
  narratorName: string;
  /** 判定结论（pov / third / uncertain）—— 见下方 POV 判定章节 */
  verdict: "pov" | "third" | "uncertain";
  /** 判定依据（中文，可直接展示） */
  reason: string;
  /** 命中的有效触发词 */
  matchedTrigger: string;
  /** 被规则否决的触发词 */
  invalidTriggers: string[];
  /** 正文第一人称计数 */
  firstPersonCount: number;
}

// --------------------------------------------------
// 1. optics 词表（规范值 + 别名归一 + 默认值）
// --------------------------------------------------

interface VocabEntry {
  name: string;
  allowed: string[];
  aliases: Record<string, string>;
  default: string;
}

const COMPOSITION: VocabEntry = {
  name: 'composition',
  allowed: ['centered composition', 'rule of thirds', 'symmetrical composition', 'golden ratio', 'dutch angle', 'sideways', 'upside-down'],
  aliases: {
    'tilted view': 'dutch angle', 'dramatic angle': 'dutch angle', 'tilted angle': 'dutch angle',
    'center composition': 'centered composition', 'central composition': 'centered composition',
    'symmetry': 'symmetrical composition',
  },
  default: 'rule of thirds',
};

const PERSPECTIVE: VocabEntry = {
  name: 'perspective',
  allowed: ['vanishing point', 'atmospheric perspective', 'panorama', 'forced perspective', 'perspective distortion', 'extreme foreshortening'],
  aliases: {
    'one-point perspective': 'vanishing point', 'one point perspective': 'vanishing point',
    'aerial perspective': 'atmospheric perspective',
    'exaggerated perspective': 'perspective distortion',
    'foreshortening': 'extreme foreshortening',
  },
  default: '', // 默认省略（无透视标签）
};

// 新增词表：相机视角、景别V2、景深、焦点目标白名单
const CAMERA_ANGLE: VocabEntry = {
  name: 'cameraAngle',
  allowed: ['front view', 'over shoulder', 'from above', 'from below', 'from side'],
  aliases: {
    "bird's-eye view": 'from above', 'birds eye view': 'from above',
    "worm's-eye view": 'from below', 'worms eye view': 'from below',
    'high angle': 'from above', 'low angle': 'from below',
    'side view': 'from side', 'profile view': 'from side',
  },
  default: 'front view',
};

const DISTANCE_V2: VocabEntry = {
  name: 'distance',
  allowed: ['close-up', 'waist up', 'cowboy shot', 'full body', 'wide shot'],
  aliases: {
    'medium shot': 'full body', 'knee up': 'cowboy shot',
    'upper body': 'waist up', 'very wide shot': 'wide shot',
    'distant view': 'wide shot', 'faraway view': 'wide shot', 'far view': 'wide shot',
  },
  default: 'full body',
};

const DEPTH_OF_FIELD: VocabEntry = {
  name: 'depthOfField',
  allowed: ['sharp focus', 'deep focus', 'depth of field', 'blurry background'],
  aliases: {
    'bokeh': 'blurry background', 'blurred background': 'blurry background',
    'shallow depth of field': 'depth of field', 'shallow dof': 'depth of field', 'dof': 'depth of field',
    'all in focus': 'sharp focus',
  },
  default: 'sharp focus',
};

// 意图映射：仅当对应字段留空时补全（键名对应新字段）
const INTENT_MAP: Record<string, Partial<{ distance: string; cameraAngle: string; composition: string; depthOfField: string; perspective: string }>> = {
  pressure: { cameraAngle: 'from below', composition: 'dutch angle' },
  cute: { cameraAngle: 'from above' },
  lonely: { distance: 'wide shot', perspective: 'atmospheric perspective', depthOfField: 'deep focus' },
  intimate: { distance: 'close-up', depthOfField: 'depth of field' },
  symmetric: { composition: 'symmetrical composition', perspective: 'vanishing point' },
  action: { composition: 'dutch angle', perspective: 'extreme foreshortening', cameraAngle: 'from below' },
  cinematic: { perspective: 'vanishing point', depthOfField: 'deep focus' },
};

const CLOSE_DISTANCES = ['close-up', 'waist up', 'cowboy shot'];
const TOO_FAR_FOR_DIRECTION = ['wide shot'];

interface ResolvedOptics {
  // 兼容旧字段（给 buildSubject/pipeline 用）
  direction: string;
  distance: string;
  angle: string;
  composition: string;
  focus: string;
  perspective: string;
  // 新字段
  subjectDirection: string;
  cameraAngle: string;
  focusTarget: string;
  depthOfField: string;
}

function normalize(raw: unknown, cat: VocabEntry): string {
  if (raw == null) return '';
  const v = String(raw).trim().toLowerCase();
  if (cat.allowed.includes(v)) return v;
  if (cat.aliases[v]) return cat.aliases[v];
  return '';
}

function resolveOptics(optics: OpticsInput | undefined, isPov: boolean, isSolo: boolean): { values: ResolvedOptics; notes: string[] } {
  const notes: string[] = [];
  const o = optics || {};
  const intent = o.intent ? INTENT_MAP[o.intent] : undefined;
  if (o.intent && !intent) notes.push(`未知 intent「${o.intent}」，已忽略`);

  // 1. subjectDirection（仅单人且非POV）
  let subjectDirection = '';
  if (o.subjectDirection && isSolo && !isPov) {
    const allowed = ['front', 'profile', 'three-quarter', 'back'];
    if (allowed.includes(o.subjectDirection)) subjectDirection = o.subjectDirection;
    else notes.push(`未知 subjectDirection「${o.subjectDirection}」，已忽略`);
  }

  // 2. cameraAngle（全局相机视角）
  let cameraAngle = normalize(o.cameraAngle, CAMERA_ANGLE);
  if (o.cameraAngle && !cameraAngle) notes.push(`未知 cameraAngle「${o.cameraAngle}」，已忽略`);

  // 3. distance（景别，互斥）
  let distance = normalize(o.distance, DISTANCE_V2);
  if (o.distance && !distance) notes.push(`未知 distance「${o.distance}」，已忽略`);
  if (!distance && intent?.distance) distance = intent.distance;
  if (!distance) distance = DISTANCE_V2.default;

  // 4. focusTarget + depthOfField（拆分后的 focus）
  let focusTarget = o.focusTarget || '';
  const allowedFocusTarget = ['subject', 'face', 'eyes', 'crotch', 'feet', 'hands', 'custom'];
  if (focusTarget && !allowedFocusTarget.includes(focusTarget)) {
    notes.push(`未知 focusTarget「${focusTarget}」，已忽略`);
    focusTarget = '';
  }
  let depthOfField = normalize(o.depthOfField, DEPTH_OF_FIELD);
  if (o.depthOfField && !depthOfField) notes.push(`未知 depthOfField「${o.depthOfField}」，已忽略`);
  if (!depthOfField && intent?.depthOfField) depthOfField = intent.depthOfField;
  if (!depthOfField) depthOfField = DEPTH_OF_FIELD.default;

  // 5. composition
  let composition = normalize(o.composition, COMPOSITION);
  if (o.composition && !composition) notes.push(`未知 composition「${o.composition}」，已忽略`);
  if (!composition && intent?.composition) composition = intent.composition;
  if (!composition) composition = COMPOSITION.default;

  // 6. perspective
  let perspective = normalize(o.perspective, PERSPECTIVE);
  if (o.perspective && !perspective) notes.push(`未知 perspective「${o.perspective}」，已忽略`);
  if (!perspective && intent?.perspective) perspective = intent.perspective;

  // —— 冲突校正 ——
  // 焦点目标需近景
  if (['crotch', 'feet', 'hands', 'face', 'eyes'].includes(focusTarget) && !CLOSE_DISTANCES.includes(distance)) {
    notes.push(`focusTarget「${focusTarget}」需近景，与「${distance}」冲突，已回退为 subject`);
    focusTarget = 'subject';
  }

  // 透视 ↔ 景别
  if (perspective === 'panorama' && distance !== 'wide shot') {
    notes.push(`panorama 需远景，与 ${distance} 冲突，已省略 perspective`);
    perspective = '';
  }
  if (perspective === 'atmospheric perspective' && distance !== 'wide shot') {
    notes.push(`atmospheric perspective 需远景，与 ${distance} 冲突，已省略 perspective`);
    perspective = '';
  }
  if (perspective === 'vanishing point' && distance === 'close-up') {
    notes.push(`vanishing point 与 close-up 冲突，已省略 perspective`);
    perspective = '';
  }
  if (['forced perspective', 'perspective distortion', 'extreme foreshortening'].includes(perspective) && !CLOSE_DISTANCES.includes(distance)) {
    notes.push(`${perspective} 需近景，与 ${distance} 冲突，已省略 perspective`);
    perspective = '';
  }

  // 相机视角冲突
  if (cameraAngle === 'over shoulder' && isSolo) {
    notes.push('over shoulder 需前景肩膀人物，单人画面无法成立，已省略 cameraAngle');
    cameraAngle = '';
  }
  if (cameraAngle && !isSolo) {
    notes.push('多角色画面各角色朝向不同，全局 cameraAngle 会歧义，已省略');
    cameraAngle = '';
  }
  if (cameraAngle && TOO_FAR_FOR_DIRECTION.includes(distance)) {
    notes.push(`${distance} 过远，相机视角不可读，已省略 cameraAngle`);
    cameraAngle = '';
  }

  // POV 禁止极俯/极仰（通过 cameraAngle 体现）
  if (isPov && ['from above', 'from below'].includes(cameraAngle)) {
    notes.push(`POV 场景禁止 ${cameraAngle}，已回退`);
    cameraAngle = '';
  }

  // 兼容旧字段映射（向后兼容）
  const direction = subjectDirection || (cameraAngle === 'front view' ? 'front' : '');
  const angle = cameraAngle === 'from above' ? "bird's-eye view" : cameraAngle === 'from below' ? "worm's-eye view" : 'eye-level view';
  const focus = focusTarget !== 'subject' ? `${focusTarget} focus` : depthOfField;

  return { 
    values: { direction, distance, angle, composition, focus, perspective, subjectDirection, cameraAngle, focusTarget, depthOfField }, 
    notes 
  };
}

// --------------------------------------------------
// 2. buildPrompt 规则引擎
// --------------------------------------------------

const AGE_LABELS: Array<{ max: number; female: string; male: string }> = [
  { max: 2, female: 'baby girl', male: 'baby boy' },
  { max: 12, female: 'little girl', male: 'little boy' },
  { max: 19, female: 'girl', male: 'boy' },
  { max: 35, female: 'woman', male: 'man' },
  { max: 50, female: 'mature female', male: 'mature male' },
  { max: Infinity, female: 'old woman', male: 'old man' },
];

const EMOTION_WORDS = ['angry', 'sad', 'happy', 'impatient', 'teasing', 'annoyed', 'worried', 'excited', 'nervous', 'irritated', 'amused', 'bored'];
const POV_HANDS_MAX_WORDS = 10;
const VAGUE_WORDS = ['bright features', 'beautiful', 'handsome', 'attractive', 'gorgeous', 'charming', 'stunning', 'lovely'];
const LOWER_BODY_WORDS = ['leg', 'legs', 'thigh', 'thighs', 'knee', 'knees', 'ankle', 'ankles', 'foot', 'feet', 'shoe', 'shoes', 'boot', 'boots'];
const UPPER_DISTANCES = ['close-up', 'waist up'];
const LOWER_CLOTHING_WORDS = ['pants', 'trousers', 'skirt', 'sock', 'socks', 'tights', 'stockings', 'leggings', 'boot', 'boots', 'shoe', 'shoes'];

function ageLabel(age: number, gender: Gender): string {
  for (const row of AGE_LABELS) {
    if (age <= row.max) return gender === 'female' ? row.female : row.male;
  }
  return gender === 'female' ? 'old woman' : 'old man';
}

function stripTrailingPunct(s: unknown): string {
  return String(s == null ? '' : s).trim()
    .replace(/[;；]/g, ', ')
    .replace(/\b(?:modified|altered)\b\s*/gi, '')
    .replace(/[.,，。、\s]+$/, '');
}

function nonEmpty(s: unknown, fallback: string): string {
  const t = stripTrailingPunct(s);
  return t || fallback;
}

/**
 * POV 场景：把第一/第二人称代词（me/my/mine/myself/I/you/your/yours）映射为 viewer/viewer's，
 * 避免 LLM 把「我/你」的方位或接触误写成叙述者角色，导致 solo 与 pov 语义冲突、构图歧义。
 * 仅 POV 生效；非 POV 原样返回（此时这些代词本就不该出现，交给系统提示词约束）。
 */
function sanitizePovPronouns(text: string, isPov: boolean): string {
  if (!isPov || !text) return text;
  return text
    .replace(/\bmy\b/gi, "viewer's")
    .replace(/\bmine\b/gi, "viewer's")
    .replace(/\byour\b/gi, "viewer's")
    .replace(/\byours\b/gi, "viewer's")
    .replace(/\bmyself\b/gi, 'viewer')
    .replace(/\byourself\b/gi, 'viewer')
    .replace(/\bme\b/gi, 'viewer')
    .replace(/\byou\b/gi, 'viewer')
    .replace(/\bI\b/g, 'viewer');
}

/** v1.9.2：确定性剔除过程词——LLM 常把 mid-thrust/thrusting 当定格态写入，致动作模糊/畸变 */
function normalizeMotionWords(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/\bmid-thrust\b/gi, 'penetration')
    .replace(/\bthrusting\b/gi, 'penetration')
    .replace(/\barching\b/gi, 'arched')
    .replace(/\bthrust\b/gi, 'penetration')
    .replace(/\bduring intercourse\b/gi, '')
    .replace(/\bhaving sex\b/gi, '')
    .replace(/\bmaking love\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,\s*/g, ', ')
    .replace(/\b([a-z]+)\s*,\s*\1\b/gi, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*$|^\s*,/g, '')
    .trim();
}

/** v1.9.2：视线/头颈朝向一致性——looking at viewer 时头须正对镜头，剔除矛盾的 head thrown back */
function normalizeGaze(s: unknown): string {
  let t = String(s == null ? '' : s);
  if (/\blooking at viewer\b/i.test(t)) {
    t = t.replace(/\bhead thrown back\b/gi, '').replace(/\bthrown back\b/gi, '');
  }
  return t.replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ',').replace(/^\s*,\s*|\s*,\s*$/g, '').trim();
}

/** v1.9.3：字段短语上限——pose/spatial/action 最多保留 N 个逗号短语，把「≤5 词」软约束变成硬约束，确定性收敛冗长动作 */
function capPhrases(s: unknown, max: number): string {
  const raw = String(s == null ? '' : s).trim();
  if (!raw) return raw;
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= max) return raw;
  return parts.slice(0, max).join(', ');
}

/** v1.9.3：逐行片段去重——按逗号切分，去除大小写不敏感下完全相同的片段，收敛重复输出 */
function dedupSegments(s: string): string {
  return s.split('\n').map((line) => {
    const seen = new Set<string>();
    return line.split(',').map((p) => p.trim()).filter((p) => {
      if (!p) return false;
      const key = p.toLowerCase().replace(/^[()]+|[()]+$/g, '').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join(', ');
  }).join('\n');
}

/**
 * 人数标签（v3.x 起默认输出，权重固定 3）：
 * - 0 个角色 → 不插入（返回 null）
 * - 1 个角色（单人）→ (solo:3)，权重固定 3
 * - N 个角色（多人）→ (Ncharacter:3)，前缀数字 = 角色总数，权重固定 3
 * POV 时返回 null：叙述者是相机，不写 solo/count 权重，避免与 pov 语义冲突。
 */
function buildCountTag(roleCount: number, isPov: boolean): string | null {
  if (isPov) return null; // POV 叙述者是相机，不写 solo/count 权重，避免与 pov 语义冲突
  if (roleCount <= 0) return null;
  if (roleCount === 1) return '(solo:3)';
  return `(${roleCount}character:3)`;
}

function buildSubject(subject: SubjectInput, isPov: boolean): string {
  const age = Number.isFinite(Number(subject.age)) ? Number(subject.age) : 25;
  const gender: Gender = subject.gender === 'male' ? 'male' : 'female';
  const genderLabel = ageLabel(age, gender);

  // 锚点主语：人类 → A <发型> <性别>；非人类种族 → A <发型> <种族肤色>-skinned <种族> <性别>
  // （实测 "a green-skinned orc" 类主语头能显著抑制非人角色的幻觉；肤色并入头部、绑定到种族主体）
  const hair = subject.hair ? stripTrailingPunct(subject.hair) : '';
  const species = subject.species
    ? stripTrailingPunct(subject.species).toLowerCase().replace(/\s+/g, ' ').replace(/^an?\s+/, '')
    : '';
  const skin = subject.skin ? stripTrailingPunct(subject.skin) : '';
  let head: string;
  if (species) {
    // green skin → green-skinned（连字符融合，肤色是种族判断的一部分）
    const skinHead = skin
      ? skin.replace(/\s*skin$/i, '').replace(/\s+/g, '-') + '-skinned'
      : '';
    head = ['A', hair, skinHead, species, genderLabel].filter(Boolean).join(' ');
  } else {
    head = hair ? `A ${hair} ${genderLabel}` : `A ${genderLabel}`;
  }

  // ':' 后动作描述：行为插入角色（sexWith）优先输出 "sex with woman/he [位置]"，
  // 否则输出 pose + spatial 作为姿势定位。
  const pose = capPhrases(sanitizePovPronouns(stripTrailingPunct(subject.pose), isPov), 2);
  let spatial = capPhrases(sanitizePovPronouns(stripTrailingPunct(subject.spatial), isPov), 1);
  const poseFirst = pose.split(/\s+/)[0];
  if (poseFirst && spatial.toLowerCase().startsWith(poseFirst.toLowerCase() + ' ')) {
    spatial = spatial.slice(poseFirst.length).trim();
  }
  // 交合标记：是否插入由 sexWith 非空决定；方向由角色自身 gender 决定
  // （male → sex with woman / female → sex with he），不信任 LLM 填写的字面值，避免方向填反。
  const sexPhrase = subject.sexWith ? (subject.gender === 'male' ? 'sex with woman' : 'sex with he') : '';
  let actionDesc: string;
  if (sexPhrase) {
    actionDesc = spatial ? `${sexPhrase} ${spatial}` : sexPhrase;
  } else {
    actionDesc = [pose, spatial].filter(Boolean).join(' ');
  }

  // ';' 后：年龄 → 动作姿态 → fully nude → 其余特征
  const ageTag = `${age}-year-old`;
  let actions = capPhrases(sanitizePovPronouns(stripTrailingPunct(subject.action), isPov), 3);
  // sexWith 角色：'sex with woman/he' 已表达插入关系，剔除动作里重复的插入类词
  // （penetrating/sex/fucking/insert/intercourse），避免 "sex with woman from her behind" 与 "penetrating her from behind" 重复。
  if (sexPhrase && actions) {
    actions = actions.split(',').map((s) => s.trim()).filter((seg) => !/penetrat|sex|fuck|insert|intercourse/i.test(seg)).join(', ').trim();
  }
  const clothing = subject.clothing ? stripTrailingPunct(subject.clothing) : '';
  const dressTag = clothing ? (/nude|naked/i.test(clothing) ? 'fully nude' : clothing) : '';

  const rest: string[] = [];
  if (subject.eyes) rest.push(stripTrailingPunct(subject.eyes));
  // 种族角色的肤色已并入主语头（green-skinned），rest 里不再重复
  if (subject.skin && !species) rest.push(stripTrailingPunct(subject.skin));
  if (subject.body) rest.push(stripTrailingPunct(subject.body));
  if (subject.face) rest.push(stripTrailingPunct(subject.face));

  const afterAge: string[] = [];
  if (actions) afterAge.push(actions);
  if (dressTag) afterAge.push(dressTag);
  afterAge.push(...rest);

  const bodyText = afterAge.length ? `, ${afterAge.join(', ')}` : '';
  return `${head}: ${actionDesc}; ${ageTag}${bodyText}.`;
}

function trimClothingForDistance(subject: SubjectInput, distance: string): SubjectInput {
  if (!subject || !subject.clothing || !['close-up', 'waist up'].includes(distance)) return subject;
  const segments = String(subject.clothing).split(',').map((s) => s.trim());
  const kept = segments.filter((seg) => !LOWER_CLOTHING_WORDS.some((w) => new RegExp('\\b' + w + '\\b', 'i').test(seg)));
  if (kept.length === segments.length) return subject;
  return { ...subject, clothing: kept.join(', ') };
}

/**
 * v2.2 校正层：规则引擎给出的**结构化确定性要素**。
 * 用于在 LLM 直出（Anima Hybrid）之上做校正，而不是丢弃规则引擎产物。
 */
export interface CorrectionInfo {
    /** 人数标签（Hard Tags 形式：1girl / 2girls / 1boy / multiple girls…） */
    countTags: string[];
    /** 归一后的镜头/构图词（Natural Language 段缺失时补入） */
    opticsWords: string[];
    /** 新增：结构化镜头词（用于标签化） */
    opticsWordsV2?: {
        subjectDirection?: string;
        cameraAngle?: string;
        distance?: string;
        focusTarget?: string;
        depthOfField?: string;
        composition?: string;
        perspective?: string;
    };
    /** 景别（用于标签兼容性裁剪） */
    distance: string;
    /** POV 场景 */
    isPov: boolean;
    /** 规则引擎告警 */
    warnings: string[];
}

/** 由 extraction 计算校正信息（不产出 prompt 文本，仅供校正层使用） */
export function buildCorrectionInfo(input: ExtractionInput): CorrectionInfo {
    const warnings: string[] = [];
    const secondary = input.secondarySubjects || [];
    const isSolo = secondary.length === 0;
    const isPov = !!input.isPovScene;
    const optics = resolveOptics(input.optics, isPov, isSolo);
    warnings.push(...optics.notes);

    // 人数标签（Anima Hard Tags 形式）
    const countTags: string[] = [];
    const females = [input.mainSubject, ...secondary].filter(s => s.gender !== 'male').length;
    const males = [input.mainSubject, ...secondary].filter(s => s.gender === 'male').length;
    const F = ['', '1girl', '2girls', '3girls', '4girls', '5girls'];
    const M = ['', '1boy', '2boys', '3boys', '4boys', '5boys'];
    if (females >= 1) countTags.push(females <= 5 ? F[females] : 'multiple girls');
    if (males >= 1) countTags.push(males <= 5 ? M[males] : 'multiple boys');

    // 兼容旧格式
    const opticsWords: string[] = [];
    const ov = optics.values;
    for (const v of [ov.direction, ov.distance, ov.angle, ov.composition, ov.focus]) {
        const t = String(v ?? "").trim();
        if (t && !/^pov\b/i.test(t)) opticsWords.push(t);
    }

    // 新增结构化镜头词
    const opticsWordsV2 = {
        subjectDirection: ov.subjectDirection,
        cameraAngle: ov.cameraAngle,
        distance: ov.distance,
        focusTarget: ov.focusTarget,
        depthOfField: ov.depthOfField,
        composition: ov.composition,
        perspective: ov.perspective,
    };

    return { countTags, opticsWords, opticsWordsV2, distance: String(ov.distance ?? ""), isPov, warnings };
}

export function buildPrompt(input: ExtractionInput): BuildResult {
  const warnings: string[] = [];
  const secondary = input.secondarySubjects || [];
  const isSolo = secondary.length === 0;
  const isPov = !!input.isPovScene;
  const roleCount = 1 + secondary.length;
  // v3.x：始终输出人数标签（权重固定 3），POV 除外；不再有独立镜头/概要行。
  const countTag = buildCountTag(roleCount, isPov);

  const optics = resolveOptics(input.optics, isPov, isSolo);
  warnings.push(...optics.notes);

  const mainForBuild = trimClothingForDistance(input.mainSubject, optics.values.distance);
  if (mainForBuild !== input.mainSubject) warnings.push(`「${optics.values.distance}」景别下已自动裁掉主角的下半身衣物`);

  const prepared: SubjectInput[] = [mainForBuild];
  for (const s of secondary) {
    const t = trimClothingForDistance(s, optics.values.distance);
    if (t !== s) warnings.push(`「${optics.values.distance}」景别下已自动裁掉次要角色的下半身衣物`);
    prepared.push(t);
  }

  // sexWith 排他 + 性别启发式：移至 deterministicCorrections.ts 统一实现
  warnings.push(...enforceSexWithExclusivity(prepared));

  const subjectLines: string[] = prepared.map((p) => buildSubject(p, isPov));

  // v1.9.5：POV 块按「性别锚点 → 手动作 → 身体部位」排序，性别（pov from male）前置；
  // 去 "pov hands" 包装（pov from male 已声明 POV），避免分散对人物姿态的刻画
  const povHandsText = (() => {
    if (!isPov) return '';                       // ← 新增
    if (!input.povHands) return '';
    const action = stripTrailingPunct(input.povHands.action);
    const anchor = stripTrailingPunct(input.povHands.anchor);
    if (!action) return anchor;
    if (!anchor || action.toLowerCase().includes(anchor.toLowerCase())) return action;
    return `${action}, ${anchor}`;
  })();
  let povGender = '';
  let povBodyRest = '';
  const povBodyRaw = isPov && input.povBody                    // ← 新增 isPov 判断
      ? sanitizePovPronouns(stripTrailingPunct(input.povBody), isPov)
      : '';
  if (povBodyRaw) {
    const idx = povBodyRaw.indexOf(',');
    if (idx >= 0) { povGender = povBodyRaw.slice(0, idx).trim(); povBodyRest = povBodyRaw.slice(idx + 1).trim(); }
    else { povGender = povBodyRaw; }
  }
  const povParts = [povGender, povHandsText, povBodyRest].filter(Boolean);
  const povLine = povParts.length ? `(${povParts.join(', ')}).` : null;

  // 环境行：environment（LLM 整句）优先，否则回退 setting（含 lighting）组装。
  let envText = '';
  if (input.environment && stripTrailingPunct(input.environment)) {
    envText = stripTrailingPunct(input.environment) + '.';
  } else {
    const setting = sanitizePovPronouns(nonEmpty(input.setting, 'simple background'), isPov);
    if (!stripTrailingPunct(input.setting)) warnings.push('setting 为空，已用默认值');
    const lighting = sanitizePovPronouns(stripTrailingPunct(input.lighting), isPov);
    envText = lighting ? `${setting}: ${lighting}.` : `${setting}.`;
  }

  // 组装：人数标签行 → 各角色行 → POV 行 → 环境行。
  // 先对每段单独清洗（normalize/dedup），再统一加行首空格并用 BREAK 连接，
  // 避免 normalizeMotionWords 的「连续空白折叠」把 "BREAK\n " 中的换行吞成空格。
  const sections: string[] = [];
  if (countTag) sections.push(`${countTag}.`);
  sections.push(...subjectLines);
  if (povLine) sections.push(povLine);
  sections.push(envText);

  const cleanedSections = sections.map((s) =>
    dedupSegments(normalizeGaze(normalizeMotionWords(s)))
  );
  const prompt = cleanedSections.map((s, i) => (i === 0 ? s : ` ${s}`)).join('\nBREAK\n');

  // 校验
  const all = [input.mainSubject, ...secondary];
  all.forEach((s, i) => {
    if (!Number.isFinite(Number(s.age))) warnings.push(`${i === 0 ? '主角' : '次要角色' + i}年龄未提供，已按 25 处理`);
  });
  const needHair = all.some((s) => !!s.hair);
  const needEyes = all.some((s) => !!s.eyes);
  const needSkin = all.some((s) => !!s.skin);
  all.forEach((s, i) => {
    const name = i === 0 ? '主角' : '次要角色' + i;
    if (needHair && !s.hair) warnings.push(`${name}缺少发色标签（多角色一致性提示；无原文出处可忽略）`);
    if (needEyes && !s.eyes) warnings.push(`${name}缺少瞳色标签（多角色一致性提示；无原文出处可忽略）`);
    if (needSkin && !s.skin) warnings.push(`${name}缺少肤色标签（多角色一致性提示；无原文出处可忽略）`);
  });
  // 动作锚定禁用第三人称代词（she/he/her/his/him/hers）：应由 LLM 改为具体特征锚定
  const PRONOUNS = ['she', 'he', 'her', 'his', 'him', 'hers'];
  all.forEach((s, i) => {
    const a = String(s.action || '');
    for (const w of PRONOUNS) {
      if (new RegExp('\\b' + w + '\\b', 'i').test(a)) {
        warnings.push(`${i === 0 ? '主角' : '次要角色' + i}的 action 含代词「${w}」，应改为具体特征锚定（如 gripping the long-black-haired woman’s waist）`);
        break;
      }
    }
  });
  for (const word of EMOTION_WORDS) {
    if (new RegExp('\\b' + word + '\\b', 'i').test(prompt)) warnings.push(`检测到情绪标签词「${word}」（M9）`);
  }
  for (const word of VAGUE_WORDS) {
    if (new RegExp('\\b' + word + '\\b', 'i').test(prompt)) warnings.push(`检测到泛泛之词「${word}」`);
  }
  if (UPPER_DISTANCES.includes(optics.values.distance)) {
    for (const word of LOWER_BODY_WORDS) {
      if (new RegExp('\\b' + word + '\\b', 'i').test(prompt)) {
        warnings.push(`距离为「${optics.values.distance}」但出现下半身描述「${word}」（景别冲突）`);
        break;
      }
    }
  }
  if (input.povHands) {
    const words = (`pov hands ${input.povHands.action} ${input.povHands.anchor}`).trim().split(/\s+/).length;
    if (words > POV_HANDS_MAX_WORDS) warnings.push(`pov 字段 ${words} 词，超过 ${POV_HANDS_MAX_WORDS} 词上限`);
  }

  return { prompt, warnings };
}

// --------------------------------------------------
// 3. POV 前置判定 + 叙述者剔除
// --------------------------------------------------

/**
 * POV 判定规则表 —— **唯一事实来源**。
 * 判定逻辑（detectPov）与设置面板的说明文案都从这里取，避免两边说法不一致。
 */
export const POV_TRIGGER_RULES = {
    /** 触发词最少字数：单字在中文里几乎必然误命中（林 → 森林/竹林/工作） */
    minLength: 2,
    /** 触发词最长字数 */
    maxLength: 32,
    /** 兜底路径：第一人称「我」出现次数阈值（超过即判 POV） */
    fallbackFirstPersonCount: 3,
    /** 兜底路径：第二人称「你」出现次数阈值（超过即判 POV） */
    fallbackSecondPersonCount: 5,
    /**
     * 黑名单：代词与虚词 —— 它们不指向任何具体角色，
     * 用作触发词会让「提到你」的所有段落被误判为 POV。
     */
    blocked: [
        '我', '你', '他', '她', '它', '咱', '俺', '您', '其', '该', '此', '这', '那', '哪', '谁', '啥',
        '我们', '你们', '他们', '她们', '它们', '咱们', '自己', '彼此', '大家', '别人', '有人', '某人', '他人',
        '人家', '什么', '怎么', '为什么', '哪里', '哪儿', '大家伙', '各位', '诸位', '本人', '在下', '小的',
        '视角', '第一人称', '第二人称', '主观视角', '叙述者', '旁白', '主角', '男主', '女主', '用户', 'assistant', 'system',
    ],
} as const;

/** 判定结论 */
export type PovVerdict = "pov" | "third" | "uncertain";

/** 触发词校验结果 */
export interface TriggerCheck {
    raw: string;
    valid: boolean;
    reason: string;
}

/** 归一化：NFKC（全角→半角）+ 去首尾空白 + ASCII 小写 */
function normalizePovText(s: string): string {
    return String(s ?? '')
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function isAsciiOnly(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
        if (s.charCodeAt(i) > 127) return false;
    }
    return true;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 去掉引号内内容（对白不参与第一人称计数） */
function stripQuoted(text: string): string {
    return String(text || '').replace(/"[^"]*"|“[^”]*”|「[^」]*」|『[^』]*』/g, '');
}

/** 第一/第二人称计数：去引号 → 排除 我们/你们/自我/忘我/无我/敌我 → 分别数「我/咱/俺」与「你」 */
export function countPovPronouns(text: string): { firstPerson: number; secondPerson: number } {
    const narration = stripQuoted(text);
    const cleaned = narration.replace(/我们|你们|自我|忘我|无我|敌我/g, '');
    const firstPerson = (cleaned.match(/[我咱俺]/g) || []).length;
    const secondPerson = (cleaned.match(/你/g) || []).length;
    return { firstPerson, secondPerson };
}

/** 切句（用于「触发词与第一人称同句共现」的佐证判定） */
function splitSentences(text: string): string[] {
    return String(text || '')
        .split(/[。！？!?；;\n]+/)
        .map(s => s.trim())
        .filter(Boolean);
}

/**
 * 触发词与第一/二人称是否**同句共现**（去掉引号后再找人称标记）。
 * 作用：区分「这段是某角色的第一/二人称」与「这段只是提到了这个角色」。
 */
function povPronounInSameSentence(text: string, name: string): boolean {
    const needle = normalizePovText(name);
    if (!needle) return false;
    for (const raw of splitSentences(text)) {
        const sentence = normalizePovText(raw);
        if (!sentence.includes(needle)) continue;
        if (/[我咱俺你]/.test(stripQuoted(raw))) return true;
    }
    return false;
}

/**
 * 校验触发词：过滤掉「不可能是叙述者名」或「极易误命中」的写法。
 * 判定与界面提示共用这张表，保证两边口径一致。
 */
export function checkPovTriggers(triggers: string[]): { valid: string[]; invalid: TriggerCheck[] } {
    const valid: string[] = [];
    const invalid: TriggerCheck[] = [];
    const blocked = new Set(POV_TRIGGER_RULES.blocked.map(t => normalizePovText(t)));
    for (const raw of triggers ?? []) {
        const t = String(raw ?? '').trim();
        if (!t) continue;
        if (t.length < POV_TRIGGER_RULES.minLength) {
            invalid.push({ raw: t, valid: false, reason: `少于 ${POV_TRIGGER_RULES.minLength} 个字，单字几乎必然误命中` });
            continue;
        }
        if (t.length > POV_TRIGGER_RULES.maxLength) {
            invalid.push({ raw: t, valid: false, reason: `超过 ${POV_TRIGGER_RULES.maxLength} 个字` });
            continue;
        }
        if (blocked.has(normalizePovText(t))) {
            invalid.push({ raw: t, valid: false, reason: '代词/常用词，不指向具体角色' });
            continue;
        }
        if (!valid.includes(t)) valid.push(t);
    }
    return { valid, invalid };
}

/** 触发词在正文中是否出现（ASCII 整词 / 中文子串） */
function triggerAppearsInBody(body: string, trigger: string): boolean {
    const t = normalizePovText(trigger);
    if (!t) return false;
    if (isAsciiOnly(t)) {
        return new RegExp(`\\b${escapeRegExp(t)}\\b`, 'i').test(body);
    }
    return body.includes(t);
}

/** 角色信息里的方块名候选（[名字] 行；跳过 MVU 的点分路径标题） */
function collectNarratorCandidates(characterInfo: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of String(characterInfo || '').matchAll(/\[([^\]]+)\]/g)) {
        const name = m[1].trim();
        if (!name || name.includes('.') || name.includes('/') || name.includes('\\')) continue;
        const key = normalizePovText(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(name);
    }
    return out;
}

/**
 * POV 前置判定（代码执行，不交给 LLM）—— v2.3 重写：
 * ① 触发词路径：**只在正文里找**（不再匹配角色信息），且必须与第一/二人称**同句共现**
 *    才认定 POV；仅被提及 → 判「uncertain」，保守按第三人称处理（不删任何角色档案）。
 * ② 兜底路径：正文第一人称「我/咱/俺」出现 > 3 次 或 第二人称「你」出现 > 5 次 → 判 POV；
 *    叙述者只在候选唯一时确定，候选缺失/不唯一 → 不剔除任何角色档案（宁多给信息，不删错人）。
 */
export function detectPov(text: string, characterInfo: string, triggers: string[] = []): PovInfo {
    const body = normalizePovText(text);
    const { valid, invalid } = checkPovTriggers(triggers);
    const { firstPerson: firstPersonCount, secondPerson: secondPersonCount } = countPovPronouns(text);
    const invalidNames = invalid.map(i => i.raw);

    // ① 触发词路径（只匹配正文）
    let matched = '';
    for (const t of valid) {
        if (triggerAppearsInBody(body, t)) { matched = t; break; }
    }
    if (matched) {
        if (povPronounInSameSentence(text, matched)) {
            return {
                isPov: true,
                verdict: "pov",
                narratorName: matched,
                reason: `触发词「${matched}」在正文中与第一/二人称同句出现 → 判定为 POV`,
                matchedTrigger: matched,
                invalidTriggers: invalidNames,
                firstPersonCount,
            };
        }
        return {
            isPov: false,
            verdict: "uncertain",
            narratorName: '',
            reason: `触发词「${matched}」在正文中命中，但同句没有第一/二人称证据（该角色只是被提及）→ 保守按第三人称处理，未剔除任何角色档案`,
            matchedTrigger: matched,
            invalidTriggers: invalidNames,
            firstPersonCount,
        };
    }

    // ② 兜底路径：第一人称「我/咱/俺」>3 次 或 第二人称「你」>5 次
    const firstPersonTriggered = firstPersonCount > POV_TRIGGER_RULES.fallbackFirstPersonCount;
    const secondPersonTriggered = secondPersonCount > POV_TRIGGER_RULES.fallbackSecondPersonCount;
    
    if (firstPersonTriggered || secondPersonTriggered) {
        const candidates = collectNarratorCandidates(characterInfo);
        const narratorName = candidates.length === 1 ? candidates[0] : '';
        const triggeredType = firstPersonTriggered ? '第一人称' : '第二人称';
        const triggeredCount = firstPersonTriggered ? firstPersonCount : secondPersonCount;
        const triggeredThreshold = firstPersonTriggered ? POV_TRIGGER_RULES.fallbackFirstPersonCount : POV_TRIGGER_RULES.fallbackSecondPersonCount;
        const reason = candidates.length === 1
            ? `正文${triggeredType}出现 ${triggeredCount} 次（阈值 ${triggeredThreshold}）且角色信息只有一个候选 → 判定为 POV`
            : `正文${triggeredType}出现 ${triggeredCount} 次（阈值 ${triggeredThreshold}）→ 判定为 POV；但叙述者候选${candidates.length === 0 ? '缺失' : '不唯一'}，未剔除任何角色档案`;
        return {
            isPov: true,
            verdict: "pov",
            narratorName,
            reason,
            matchedTrigger: '',
            invalidTriggers: invalidNames,
            firstPersonCount,
        };
    }

    return {
        isPov: false,
        verdict: "third",
        narratorName: '',
        reason: `无有效触发词命中，正文第一人称 ${firstPersonCount} 次（阈值 ${POV_TRIGGER_RULES.fallbackFirstPersonCount}）、第二人称 ${secondPersonCount} 次（阈值 ${POV_TRIGGER_RULES.fallbackSecondPersonCount}）→ 判定为第三人称`,
        matchedTrigger: '',
        invalidTriggers: invalidNames,
        firstPersonCount,
    };
}

/** 剔除结果 */
export interface StripResult {
    /** 剔除后的角色信息 */
    text: string;
    /** 实际匹配到的方块名（空 = 未匹配到任何方块） */
    matched: string;
    /** 剔除掉的方块数 */
    removedBlocks: number;
    /** 是否没匹配到（调用方应记告警，不要静默失败） */
    failed: boolean;
}

/**
 * POV 场景：从角色信息里剔除叙述者**整块**（其外观永不入画）。
 * v2.2：按块剔除（从 [name] 行起，直到下一个 [name] 或段头行为止），
 * 兼容「单行条目」与「多行条目」两种格式；旧实现只删标题行，会把叙述者的
 * 字段行（外貌/服装/性格）留在提示词里造成信息泄漏。
 * v2.3：方块名容错匹配（去除括号/称谓后比对，ASCII 大小写无关），
 * 匹配不到时**不静默失败**——返回 failed=true，由调用方记告警。
 */
export function stripNarrator(characterInfo: string, narratorName: string): StripResult {
    const result: StripResult = { text: characterInfo || '', matched: '', removedBlocks: 0, failed: false };
    if (!characterInfo || !narratorName) return result;
    const target = normalizePovText(narratorName);
    if (!target) return result;
    // 容错：方块名去掉括号/称谓后与目标比对（"晁大棒(男主)" ↔ "晁大棒"）
    const loose = (s: string) => normalizePovText(s).replace(/[（(【[][^）)】]*[）)】]/g, '').replace(/[\s·・]/g, '');
    const looseTarget = loose(narratorName);
    const lines = characterInfo.split('\n');
    const kept: string[] = [];
    let skipping = false;
    for (const line of lines) {
        const trimmed = line.trim();
        // 段头行（【角色信息·X】）结束跳过状态
        if (/^【[^】]*】/.test(trimmed)) {
            skipping = false;
            kept.push(line);
            continue;
        }
        const m = trimmed.match(/^\[([^\]]+)\]/);
        if (m) {
            const name = m[1].trim();
            const key = normalizePovText(name);
            skipping = key === target || (!!looseTarget && loose(name) === looseTarget);
            if (skipping) {
                result.removedBlocks++;
                if (!result.matched) result.matched = name;
                continue;   // 叙述者块的标题行本身也不保留
            }
        } else if (skipping) {
            // 块内续行（键:值 行）→ 一并剔除
            continue;
        }
        kept.push(line);
    }
    result.text = kept.join('\n');
    result.failed = result.removedBlocks === 0;
    return result;
}

/**
 * 测试 POV 判定（供 UI 调试用）
 */
export function testPovDetection(text: string, characterInfo: string, triggers: string[] = []): {
    povInfo: PovInfo;
    debug: {
        normalizedBody: string;
        validTriggers: string[];
        invalidTriggers: TriggerCheck[];
        firstPersonCount: number;
        secondPersonCount: number;
        povSentences: string[];
        triggerMatches: Array<{trigger: string, inBody: boolean, inSameSentence: boolean}>;
    };
} {
    const body = normalizePovText(text);
    const { valid, invalid } = checkPovTriggers(triggers);
    const { firstPerson: firstPersonCount, secondPerson: secondPersonCount } = countPovPronouns(text);
    
    // 找出包含第一/二人称的句子
    const sentences = splitSentences(text);
    const povSentences = sentences.filter(s => /[我咱俺你]/.test(stripQuoted(s)));
    
    // 检查每个触发词的匹配情况
    const triggerMatches = valid.map(t => ({
        trigger: t,
        inBody: triggerAppearsInBody(body, t),
        inSameSentence: povPronounInSameSentence(text, t),
    }));
    
    const povInfo = detectPov(text, characterInfo, triggers);
    
    return {
        povInfo,
        debug: {
            normalizedBody: body,
            validTriggers: valid,
            invalidTriggers: invalid,
            firstPersonCount,
            secondPersonCount,
            povSentences,
            triggerMatches,
        }
    };
}

/** 界面提示文案（由规则表生成，避免与判定逻辑脱节） */
export function describePovTriggers(triggers: string[]): { valid: string[]; invalid: TriggerCheck[]; text: string } {
    const { valid, invalid } = checkPovTriggers(triggers);
    const lines: string[] = [];
    lines.push(`判定规则：触发词只在【正文】里匹配（不匹配角色信息），且必须与第一/二人称「我/咱/俺/你」同句共现才判 POV；仅被提及 → 保守按第三人称处理，不删任何角色档案。`);
    lines.push(`触发词要求：≥ ${POV_TRIGGER_RULES.minLength} 个字、不能是代词/常用词；英文按整词匹配（Al 不会命中 Albus），中文按子串匹配。`);
    lines.push(`兜底：正文第一人称「我/咱/俺」> ${POV_TRIGGER_RULES.fallbackFirstPersonCount} 次、或第二人称「你」> ${POV_TRIGGER_RULES.fallbackSecondPersonCount} 次 → 判 POV；叙述者候选不唯一时不剔除任何角色档案。`);
    if (valid.length) lines.push(`当前有效触发词：${valid.join('、')}`);
    if (invalid.length) {
        lines.push(`⚠ 已忽略：${invalid.map(i => `「${i.raw}」（${i.reason}）`).join('；')}`);
    }
    if (!valid.length && !invalid.length) {
        lines.push('当前未设置触发词 → 仅用第一/二人称密度兜底。');
    }
    return { valid, invalid, text: lines.join('\n') };
}

// --------------------------------------------------
// 4. JSON 解析
// --------------------------------------------------

/** 校验 ExtractionInput 必填字段 */
function validateExtractionSchema(obj: unknown): obj is ExtractionInput {
    if (!obj || typeof obj !== 'object') return false;
    const record = obj as Record<string, unknown>;
    if (!record.mainSubject || typeof record.mainSubject !== 'object') return false;
    const ms = record.mainSubject as Record<string, unknown>;
    if (typeof ms.age !== 'number' || !Number.isFinite(ms.age)) return false;
    if (ms.gender !== 'female' && ms.gender !== 'male') return false;
    // custom 模式需要 prompt 字段
    if (record.prompt !== undefined && typeof record.prompt !== 'string') return false;
    return true;
}

/** 从字符串中提取最大的合法 JSON 对象（处理嵌套） */
function extractLargestValidJson(s: string): string | null {
    let best: string | null = null;
    let bestLen = 0;
    let depth = 0;
    let start = -1;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === '}') {
            if (depth > 0) {
                depth--;
                if (depth === 0 && start !== -1) {
                    const candidate = s.slice(start, i + 1);
                    try {
                        JSON.parse(candidate);
                        if (candidate.length > bestLen) {
                            best = candidate;
                            bestLen = candidate.length;
                        }
                    } catch { /* ignore */ }
                }
            }
        }
    }
    return best;
}

/** 策略 1: <json>...</json> 标签对 */
function extractJsonTag(s: string): string | null {
    const start = s.indexOf('<json>');
    const end = s.lastIndexOf('</json>');
    if (start !== -1 && end !== -1 && end > start) {
        return s.slice(start + 6, end).trim();
    }
    return null;
}

/** 策略 2: </thinking> 之后的第一个完整 JSON 对象 */
function extractAfterThinking(s: string): string | null {
    const thinkingEnd = s.lastIndexOf('</thinking>');
    const after = thinkingEnd >= 0 ? s.slice(thinkingEnd + '</thinking>'.length).trim() : s;
    const firstBrace = after.indexOf('{');
    if (firstBrace === -1) return null;
    // 从第一个 { 开始，找匹配的 }
    let depth = 0;
    for (let i = firstBrace; i < after.length; i++) {
        if (after[i] === '{') depth++;
        else if (after[i] === '}') {
            depth--;
            if (depth === 0) {
                return after.slice(firstBrace, i + 1);
            }
        }
    }
    return null;
}

/** 策略 3: 全文扫描最大合法 JSON */
function extractAnyJson(s: string): string | null {
    return extractLargestValidJson(s);
}

export function parseJson(raw: string): ExtractionInput {
    const cleaned = String(raw).replace(/```(?:json)?/gi, '').trim();
    
    // 多策略提取，按优先级尝试
    const strategies = [
        { name: 'json-tag', fn: extractJsonTag },
        { name: 'after-thinking', fn: extractAfterThinking },
        { name: 'largest-valid', fn: extractAnyJson },
    ];
    
    let lastError: Error | null = null;
    let lastSlice = '';
    
    for (const { name, fn } of strategies) {
        const slice = fn(cleaned);
        if (!slice) continue;
        lastSlice = slice;
        
        // 先尝试直接解析
        try {
            const parsed = JSON.parse(slice) as ExtractionInput;
            if (validateExtractionSchema(parsed)) {
                if (name !== 'json-tag') {
                    console.warn(`[image_st] parseJson: 使用 ${name} 策略提取成功`);
                }
                return parsed;
            }
        } catch { /* 继续尝试修复 */ }
        
        // 尝试修复后解析
        try {
            const repaired = repairJson(slice);
            const parsed = JSON.parse(repaired) as ExtractionInput;
            if (validateExtractionSchema(parsed)) {
                console.warn(`[image_st] JSON 修复成功（策略: ${name}，尾逗号/BOM/零宽字符）`);
                return parsed;
            }
        } catch (e) {
            lastError = e instanceof Error ? e : new Error(String(e));
        }
    }
    
    // 所有策略都失败，抛出详细错误
    const preview = (lastSlice || cleaned).slice(0, 500);
    throw new Error(
        `JSON 解析失败（尝试了 ${strategies.map(s => s.name).join(', ')}）` +
        `— 最近切片前 500 字：${preview}` +
        (lastError ? ` — 最后错误：${lastError.message}` : '')
    );
}

function repairJson(s: string): string {
    return s
        .replace(/^\uFEFF/, '')                              // BOM
        .replace(/,\s*([}\]])/g, '$1')                       // 尾逗号
        .replace(/[\u200B-\u200D\uFEFF]/g, '')               // 零宽字符
        .replace(/\/\*[\s\S]*?\*\//g, '')                    // /* */ 注释
        .replace(/(^|[^\\])(\/\/.*$)/gm, '$1')               // // 注释（行尾）
        .replace(/\bNaN\b/g, 'null')                         // NaN → null
        .replace(/\bInfinity\b/g, 'null')                    // Infinity → null
        .replace(/\bundefined\b/g, 'null')                   // undefined → null
        // 单引号字符串 → 双引号（简易：不处理转义内的引号，覆盖 90% 场景）
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner) => `"${inner.replace(/\\'/g, "'")}"`);
}

// --------------------------------------------------
// 5. 系统提示词（POV / 第三人称两套）
// --------------------------------------------------

/**
 * v2.7：第一阶段的**推理骨架**（可编辑层）。
 *
 * 为什么要重写：原来的 0-9 号任务是一份 3,957 字的散文式长清单。弱模型
 * （DeepSeek-V4.1-Flash 一类）实测会直接无视它、写成一段自由发挥的思考 ——
 * 证据就是插件自己的 v2.6 回放测试里那 11 项实测缺陷（分级不在首位、
 * 质量咒语吐出来、前置短语三连、句中大写…），它们全靠阶段 5-7 的后处理层兜底，
 * 而不是靠提示词约束住的。
 *
 * 改法（"可复制骨架"思路）：
 *   ① 0-9 号任务压成 **6 段**，每段一行标题 + 一个填空槽，模型能直接照抄格式；
 *   ② 每段只问一个决策问题，**不复述规则**（规则全部下沉到固定层的 TASK_DETAIL_LINES）；
 *   ③ 明令"不得合并成散文"，并给收束闸门（</thinking> 之后立刻输出 <json>）。
 *
 * 同族实测经验：给"标签 + 槽位"的围栏比给散文描述有效得多；独立成条、互相引用的
 * 模块模型会跳过；合在一段里的多块内容模型只执行第一块。所以 6 段写在一块、
 * 每段都有独立标题、禁止合并。
 */
const COMMON_RULES = [
  '你是 AI 图像提示词工程师。从小说片段锁定一个单一静态画面，输出一份结构化 JSON。',
  '',
  '# 推理规则（强制思维链）',
  '',
  'A. 先输出 <thinking>…</thinking>，再输出 <json>…</json>。thinking 内按下面 6 段逐段写，每段独占一行，格式固定为「段名：内容」；只写结论与关键标签词。',
  '',
  'B. thinking 合计 ≤400 字、简体中文、电报式要点；不得起草正文句子、不得罗列整段英文标签、不得写最终答案草稿。',
  '',
  'C. 6 段都要写；某段本轮不适用就写「不适用」并跳过，不得编造内容填位。',
  '',
  'D. 6 段之间不得合并、不得改写成散文段落、不得加小标题以外的解释。',
  '',
  'E. </thinking> 之后立刻输出 <json>，中间不得有任何文字。thinking 内不得出现 { } 或任何 JSON 片段；<json> 内不得出现推理、解释或 Markdown 围栏。',
  '',
  '1 峰值：<本轮锁定的那一个静态瞬间 + 一句为什么>',
  '2 角色：<出场名单 / 排除名单 / 叙述者是否等于相机>',
  '3 取景：<distance 取值 + 因该景别被裁掉的部位>',
  '4 人物：<每个角色的关键标签词：年龄/性别/发色/发长/瞳色/肤色/体型/服装/姿势/位置/动作>',
  '5 画面：<环境 + 光影 + 镜头 + 动作链 + 方位关系>',
  '6 校验：<逐条过下方固定规范区的【认知铁律】10 条；命中写「×」并给出修正后的写法>',
  '',
  '各段的口径、字段定义、词表与全部细则见下方固定规范区；本段只做决策，不复述规则。',
  '',
  '# 可选值（选不出就留空，代码用默认值补全；互斥/依赖由代码自动处理）',
  '- subjectDirection（人物朝向，仅单人非POV填写）：front | profile | three-quarter | back',
  '- cameraAngle（相机视角，全局）：front view | over shoulder | from above | from below | from side',
  '- distance（景别，互斥）：close-up | waist up | cowboy shot | full body | wide shot',
  '- focusTarget（焦点目标）：subject | face | eyes | crotch | feet | hands | custom',
  '- depthOfField（景深）：sharp focus | deep focus | depth of field | blurry background',
  '- composition（构图）：centered composition | rule of thirds | symmetrical composition | golden ratio | dutch angle | sideways | upside-down',
  '- perspective（透视）：vanishing point | atmospheric perspective | panorama | forced perspective | perspective distortion | extreme foreshortening',
  '- intent（仅供程序内部用，不直接生成标签）：pressure | cute | lonely | intimate | symmetric | action | cinematic',
  '- pose（姿态，单选）：standing | sitting | lying | lying on side | kneeling | squatting | on all fours | arched back | spread legs | legs up | knees up | bent over | straddling | reclining | curled up',
  '- action（动作/视线，单选）：looking at viewer | looking up at viewer | looking down at viewer | looking away | looking back | holding | reaching out | gripping | grabbing | clawing | hugging | kissing | licking | sucking | rubbing | grinding | squeezing | fingering | stroking | penetration',
  '',
  '输出 JSON：把上面 6 段的决策落成最终 JSON。',
];

/**
 * v2.7：**执行细则**（固定规范区）。
 *
 * 从可编辑层下沉下来的原 0-9 号任务细则。目的有三：
 *   ① 推理层只保留"做什么决策"，规则留在固定层 —— 用户改写推理骨架不会误删规则
 *      （这才是 v2.4 三层结构当初想解决、但没做完的那一半）；
 *   ② 规则集中在一处，抽取与审核两阶段引用同一份口径；
 *   ③ 推理层从 3,957 字降到约 700 字，弱模型更容易照抄 6 段格式。
 */
const TASK_DETAIL_LINES: string[] = [
  '',
  '# 执行细则（推理各段的口径；固定规范区，用户改写预设也不会丢）',
  '',
  '## 峰值定位（推理第 1 段）',
  '- 通读整段，锁定「峰值瞬间」：动作最激烈、情绪/生理反应到顶、人物冲突最尖锐、视觉信息最密集的那一个静态定格。',
  '- 判据优先级：① 人物间最激烈的互动/接触/冲突 ② 情绪或身体反应的顶点 ③ 最有画面冲击力的姿态/构图 ④ 信息密度最高的动作瞬间。',
  '- 严禁取开头或结尾的平静时刻（事后余韵、入睡、静静相拥、发呆、收拾现场）；正文存在激烈互动峰值时，不得退而取单个角色的安静特写。',
  '- 例：接吻→做爱→高潮→事后的段落，画面必须取自做爱/高潮峰值，而非事后的「余韵」。仅当整段确为静态抒情、无任何冲突时，才允许取安静画面。',
  '',
  '## 角色出场（推理第 2 段）',
  '- 只把「实际在场、有动作/位置/状态描述」的角色列为主角或次要角色；仅被提及/讨论/回忆/听说的角色一律不入画、其外观一律忽略。',
  '- POV 场景下叙述者（我/你）即相机、不是画面角色，严禁列入 mainSubject/secondarySubjects/summary。',
  '',
  '## 景别与可见范围（推理第 3 段）',
  '- 先定 distance，再据此裁掉不可见部位：close-up 仅头面部；waist up 头到腰；cowboy shot 膝以上；medium shot 大腿以上；full body 及更远才可全身。',
  '- clothing 同样只写该距离可见部分。',
  '',
  '## 主角与次要角色字段（推理第 4 段）',
  '- age 必填数字（缺省 25）；gender 必填 female/male。',
  '- pose 从【姿态词表】选 1 个规范值；spatial 只写 1 个空间位置（on the bed / beneath viewer，必带参照物）；action 从【动作词表】选 1 个规范值。三者各只准 1 个，禁止逗号堆叠、禁止同义重复（arched back 与 arching back 二选一）。',
  '- hair/eyes/skin/body/face/clothing 用 ≤5 词英文标签短语，仅原文/角色信息有依据时写，无出处一律省略、严禁臆造（body 仅原文有依据时写，如 large breasts；不用 lean build / fair skin 等默认或示例值当出处）。',
  '- 严禁 me/my/I/you/your 等第一二人称代词（POV 场景指代叙述者时改用 viewer / viewer’s）。',
  '- sexWith：仅当本角色阴茎/阴道与异性性器官发生插入（本角色是插入方）时填，方向与自身性别互补（男角色填 woman / 女角色填 he），一幅画面至多一名插入方，被插入方与未插入角色绝不填。',
  '- species：仅当角色为人类以外的种族/生物时填小写英文标签（orc、goblin、troll、ogre、elf、dark elf、dwarf、halfling、vampire、succubus、demon、angel、beastman、furry、wolf、fox、tiger、horse、dragon、lizardman、slime、mermaid、harpy、centaur、minotaur、oni、kitsune、catgirl、dog girl、robot、android、cyborg、ghost、zombie、undead、insectoid 等）；人类角色一律省略。',
  '- 种族独有肤色（green skin / grey skin）写进 skin；种族特征（tusks、horns、pointy ears、tail、wings）写进 body/face。',
  '- 次要角色 0-2 个，规则同主角。',
  '- 多角色一致性靠「位置词 + 已有特征」隔离，禁止为了补齐而臆造肤色/瞳色/发色（black hair / brown eyes / fair skin 等默认值一律不用，无出处就省略该字段）。',
  '- 双人互动必须写在一个连续动作链里（如「A is hugging B from behind」「A sitting on B’s lap」），空间关系嵌入动作，动作对象用具体特征锚定（禁止 she/he/her/his 代词）；不得拆成两个独立段落、不得用「一侧/另一侧」等模糊方位。',
  '- 三人及以上必须给每个角色明确位置（On the left / In the center / On the right）并把特征绑定到具体角色（A with long hair / B with short hair）。',
  '- 两男一女场景：sexWith 只给「阴茎插入阴道」的那个男角色填 woman（唯一插入方）；两女一男场景：sexWith 只给「阴道/阴茎交合」的那个女角色填 he。',
  '',
  '## 环境与光影（推理第 5 段）',
  '- setting 用 3-6 词英文短语（含关键物件）；lighting 用 1-3 个英文术语。',
  '- summary.scene / summary.light 用简短无逗号英文短语。',
  '- environment 整句：地点 + `:` + 细节 + 光照，无 A 前缀、无句号（如 dim dressing room: half-drawn privacy curtain, warm lamplight from above）。它是最终环境行的唯一来源。',
  '',
  '## 镜头参数（推理第 5 段）',
  '- subjectDirection/cameraAngle/distance/focusTarget/depthOfField/composition/perspective/intent 从【可选值】表中选；选不出留空交给代码默认。',
  '- focusTarget 需近景（close-up/waist up/cowboy shot）。',
  '- cameraAngle 仅单人非 POV 时填写；多角色画面不填（各角色朝向在各自 spatial/pose 体现）。',
  '',
  '## 认知铁律（推理第 6 段逐条过）',
  '① 所见即所得：每个元素必须有原文或角色信息出处，禁止场景补全、禁止凭空添加颜色/材质/属性；',
  '② 特征优先级：原文 > 角色信息；',
  '③ 简洁提炼：每特征 ≤5 词，删除位置细节、微小细节、次要修饰，禁 modified/bright features/beautiful/handsome 等泛词；',
  '④ 静态化：动词必须能被一张静态照片捕捉（crouching/standing/sitting，不用 running/brushing）；',
  '⑤ 表情纯视觉化：只用 raised eyebrow/furrowed brow 等解剖术语，禁用 angry/happy/sad 等情绪词；',
  '⑥ 动作/视线有具体锚点，禁用 straight ahead/forward 等模糊方向；',
  '⑦ 输出语言：所有标签字段用英文标签式短语（形容词+名词），禁止冗长从句、禁止中文；',
  '⑧ 无内容的可选字段直接省略，不得输出空字符串或 null；',
  '⑨ 身体一致性：每个部位同一瞬间只占一个位置（单一锚点），头/脸/双手/躯干朝向互相一致，禁止分身、悬空手、朝向矛盾；',
  '⑩ 朝向↔表情一致：背对/侧对镜头（direction=from behind / profile）时禁止写正面面部表情或 looking at viewer（会强制角色回头），只写背面可见特征；只有 front view 才写面部表情与视线（looking back 例外，可配 from behind）。',
];

export const POV_SECTION = [
  '',
  '# 后追加 · 视角（已激活：判定为第一/第二人称主观视角）',
  '这是第一/第二人称主观视角：叙述者（"我/你"）即相机。除「明确可见的身体部位」外，叙述者的任何身体部位/衣物/影子不得出现在画面中。',
  '叙述者不是画面中的角色：不要把它列入 mainSubject/secondarySubjects/summary，它只通过 povHands（手）与 povBody（其他出镜部位）出现。',
  '叙述者出镜分三档：① 纯视角不出镜（无手无身体，仅用构图词模拟）② 仅手出镜（povHands）③ 手+生殖器等身体部位出镜（povHands + povBody）。',
  'povHands 判断：叙述者的手是否与画面内元素存在物理接触（握/抓/指/按/递/推/捧）。有则输出 povHands（action=英文动作短语，anchor=英文锚点对象），无则省略。',
  'povBody 判断（性行为场景必需）：当锁定画面是性行为（插入/抽插/骑乘/口交等）且叙述者生殖器在该瞬间可见时，必须输出 povBody（英文 tag，如 pov from male, pov crotch, penis, penetration）；叙述者性别未声明默认 male。非性行为或生殖器不可见时省略 povBody。',
  '严禁 povBody 中出现叙述者脸/头/躯干（viewer’s face/head 会崩图）；只写手、生殖器、腿等该瞬间实际可见的部位。',
  'povBody 绑定铁律：生殖器必须用 pov / viewer’s 绑定（pov crotch / viewer’s penis / pov from male），严禁写 erection 等无绑定状态词（会被错误画到女性身上变成扶她）；povBody 位置必须与体位一致（如 missionary 时 pov crotch 在女方腿间、penetration 指向女方下体，绝非女方头部附近，避免被解析为 69）。',
  '主体视线铁律：POV 下被看的角色（mainSubject）脸/视线应朝向相机（looking at viewer / looking up at viewer / looking down at viewer），头部正面面向镜头增强第一人称感；除非原文明确侧脸/背面才可写 looking away / looking back。严禁同时写 head thrown back（头后仰，视线朝上）与 looking at viewer（看镜头，头正对镜头）——二者互相矛盾，只能二选一；head thrown back 只能配 looking up / rolled eyes。',
  '注意单一静态瞬间：povHands/povBody 必须与 mainSubject 姿态同一瞬间、且锚点在该画面内；发生在锁定时刻前后或锚点不在画面中，一律不填。',
];

export const NON_POV_SECTION = [
  '',
  '# 后追加 · 视角（已判定为第三人称客观视角）',
  '这是第三人称客观视角：画面中没有"我/你"的主观身体部位，不要输出 povHands / povBody 字段。',
];

const SCHEMA_HEAD = [
  '',
  '# 输出 JSON 结构（字段名严格一致；可省略的字段不输出）',
  '{',
  '  "mainSubject": {',
  '    "age": 数字, "gender": "female"或"male",',
  '    "species": "非人类种族/生物时填（orc/elf/kitsune/dragon/wolf…小写英文），人类省略",',
  '    "pose": "英文静态姿势（lying on back / standing / sitting / arched back / spread legs / on all fours）", "spatial": "英文空间位置（on the bed / beneath viewer / over the stool / in front of X，必带参照物）",',
  '    "hair": "英文发型与颜色", "eyes": "英文瞳色", "skin": "英文肤色",',
  '    "body": "英文身材/体型特征（仅原文有依据时写，如 large breasts）", "face": "英文面部特征（仅 front view 时写）", "clothing": "英文服装由外到内", "action": "英文互动动作链与视线（gripping the stool edge / reaching out to X / looking at mirror）",',
  '    "sexWith": "交合标记（仅当本角色阴茎/阴道与异性性器官发生插入时填：两男一女写 woman / 两女一男写 he；一般情况下 N 人仅一名角色填，未插入则不输出此字段）"',
  '  },',
  '  "secondarySubjects": [同 mainSubject 结构（含 sexWith）, 0-2 个, 无则省略],',
];

const SCHEMA_POV = [
  '  "povHands": { "action": "英文动作短语", "anchor": "英文锚点对象" },',
  '  "povBody": "叙述者出镜部位英文 tag（仅性行为等需露出生殖器时，如 pov from male, pov crotch, penis, penetration；无则省略）",',
];

const SCHEMA_TAIL = [
    '  "summary": { "scene": "英文场景概括短语", "light": "英文光影概括短语" },',
    '  "setting": "英文场景标签", "lighting": "英文光照标签",',
    '  "environment": "环境整句（LLM 直接产出完整一句：地点 + `:` + 细节 + 光照，无 A 前缀、无句号，如 dim dressing room: half-drawn privacy curtain, warm lamplight from above）",',
    '  "optics": { "subjectDirection": "", "cameraAngle": "", "distance": "", "focusTarget": "", "depthOfField": "", "composition": "", "perspective": "", "intent": "" }',
    '}',
];

/**
 * v2.2：双表示输出字段（可选）。
 * description = Natural Language（动作/视线/交互/构图/光照）；
 * tags = Hard Tags（外观与身份：发色/发型/瞳色/肤色/服装/人数等）。
 * 至少给出一份（由输出模式决定主输出）；缺失时插件回退到规则引擎产物，不破链。
 */
/**
 * v2.4：schema 里的双表示字段说明**按模式精确化**。
 * 此前三种模式的 schema 完全相同 → 在 tags 模式里仍描述 description 的写法要求，
 * 模型会顺手写一段 description（被插件丢弃，纯浪费 token）。
 */
function buildSchemaDual(mode: "mixed" | "description" | "tags" | "custom"): string[] {
    if (mode === "tags") {
        return [
            '  "description": "（本次模式不需要此字段，禁止输出）",',
            '  "tags": ["1girl", "solo", "black hair", "long hair", "blue eyes", "school uniform"],',
        ];
    }
    if (mode === "description") {
        return [
            '  "description": "Natural Language 段：完整英文句子（现在时、主动语态、每句 10~29 词、句末句号；主体动作/视线/角色交互/姿态/构图/光影/空间关系/画面文字；不写外观枚举）",',
            '  "tags": "（本次模式不需要此字段，禁止输出）",',
        ];
    }
    if (mode === "custom") {
        return [
            '  "prompt": "完整最终提示词（含 \\nBREAK\\n 分段）",',
            '  "notes": "可选说明",',
        ];
    }
    return [
        '  "description": "Natural Language 段：完整英文句子（现在时、主动语态、每句 10~29 词、句末句号；按三层：主体姿态 → 互动空间 → 镜头环境光影收束；不写外观枚举）",',
        '  "tags": ["1girl", "solo", "black hair", "long hair", "blue eyes", "school uniform"],',
    ];
}

/**
 * v2.4：三种输出模式的**职责分离规范**（替换 v2.2 的统一 DUAL_OUTPUT_RULES）。
 * ------------------------------------------------------------
 * v2.2 的问题：三种模式共用同一段规范，导致
 *   ① 「只解析自然语言」模式也去要求填 tags（插件根本不读）；
 *   ② tags 规范里强制写 masterpiece / best quality / @artist
 *      —— 与插件既定决策「不采纳质量提示词与画师串」**直接冲突**，
 *      也与实测语料（80 条 0 条使用质量词）相悖；
 *   ③ 没给出标签顺序 / 长度预算 / 权重纪律 / 缺失标签，
 *      LLM 只能凭感觉排标签 → 输出长度与顺序不可控。
 * v2.4 起：规范按模式精确切分，全部条款来自 promptGuidelines（语料实测结论）。
 *
 * 域划分（关键）：
 *   - **tags 域**（标签书写、维度顺序、权重纪律、IP 语法）→ 只与 tags 输出有关，
 *     只在 tags / mixed 模式给出；description / custom 模式给出这些是纯噪声。
 *   - **description 域**（散文语法规范）→ 只与 description 输出有关。
 *   - **custom 域**（完全自定义）→ 不注入任何规范，仅保留通用硬性约束。
 *   - **通用域**（长度预算、多角色隔离）→ 四模式都给。
 */
function buildModeRules(mode: "mixed" | "description" | "tags" | "custom"): string[] {
    const head = [
        "# 本次输出模式与职责分工（务必严格遵守）",
        "",
        mode === "mixed"
            ? "**混合式**：description（动作/关系/空间/光影）与 tags（外观/身份/数量）**两者都必须给出**，且严格分工。"
            : mode === "tags"
                ? "**只解析 Danbooru 标签**：tags **必填**；description **可选（极简增量）**；若输出 description 必须遵循 tags 模式增量规范。"
                : mode === "custom"
                    ? "**完全自定义**：插件不干预任何输出格式、不注入规范、不追加契约。用户预设即完整系统提示词，LLM 输出格式任意，插件自动提取 prompt 字段送生图。"
                    : "**只解析自然语言描述**：description **必填**；tags **不要输出**（插件会忽略它）。但必须填写 mainSubject/optics 等隐性结构化字段供程序校正。",
        "",
    ];

    const tagsBlock = [
        "## tags 字段 = 第一层 Hard Tags（只放外观与身份，禁止写完整英文句子）",
        "- 只放：安全分级（sensitive / explicit / nsfw，仅在原文确实涉及时）、人数与性别、物种、作品、发型发色、瞳色、肤色、体型、服装（由外到内）、饰品、场景标签、表情、动作、精确场景焦点。",
        "- 不放：动作细节的展开、视线句子、空间关系句、光影句子 —— 这些归 description（或 tags 模式下的 description 增量）。",
        ...TAG_SYNTAX_RULES.slice(1),
        "",
        ...TAG_ORDER_LINES,
        "",
        ...TAG_WEIGHT_RULES,
    ];

    const descBlock = [
        "## description 字段 = 第二层 Natural Language（完整英文句子）",
        "- 只放：主体动作、视线方向与注视对象、角色交互、姿态、构图、镜头、光照、空间关系、画面文字。",
        "- 不放：外观与服装的枚举（那归 tags）。",
        ...DESCRIPTION_SYNTAX_RULES.slice(1),
    ];

    const common = [
        "",
        "## 硬性约束",
        "- 只锁定「一个静态画面」，不写过程、先后、内心活动。",
        "- 不为了丰富画面感添加原文没有的前景/道具/气氛。",
        "- 插件会把 tags 与 description 重排为「Hard Tags 段在前，Natural Language 段在后」；你只需保证两个字段各自职责正确。",
    ];

    // v2.6：精炼与降噪（三模式共用 —— 噪点不分模式）
    const precision = ["", ...PRECISION_LINES];
    // v2.6：输出前自检（三模式共用；条目按模式过滤 —— tags 模式不出现散文语法条目）
    const selfCheck = ["", "## 输出前自检（逐条过一遍，有一条不过就改）",
        ...OUTPUT_SELF_CHECK.filter(x => x.modes.includes(mode as "tags" | "description" | "mixed" | "custom")).map(x => x.line)];

    if (mode === "tags") {
        // tags 模式：标签规范 + 极简 description 增量规范 + 词表 + 自检
        return [...head, ...tagsBlock, "", ...TAGS_MODE_DESCRIPTION_RULES, "", ...CORPUS_VOCAB_LINES, ...precision, ...selfCheck, "", ...LENGTH_BUDGET_LINES, ...common];
    }
    if (mode === "description") {
        // description 模式：三层结构 + 隐性字段一致性 + 句式参考 + 自检
        return [...head, ...descBlock, "", ...DESCRIPTION_MODE_RULES, "", ...PROSE_VOCAB_LINES, ...precision, ...selfCheck, "", ...LENGTH_BUDGET_LINES_DESC, ...common];
    }
    if (mode === "custom") {
        // custom 模式：仅保留基础约束 + 通用硬性约束，不注入任何规范
        return [...head, ...common, ...precision, ...selfCheck];
    }
    return [...head, ...tagsBlock, "", ...CORPUS_VOCAB_LINES, "", ...descBlock, "", ...PROSE_VOCAB_LINES, ...precision, ...selfCheck, "", ...LENGTH_BUDGET_LINES, ...LENGTH_BUDGET_LINES_DESC, ...common];
}

/** 多角色隔离规范（三种模式共用） */
const MULTI_CHARACTER_BLOCK = MULTI_CHARACTER_RULES;


// --------------------------------------------------
// v2.6：四模式各自独立的一份提示词
// --------------------------------------------------
/**
 * v2.6：四种输出模式**各有一份提示词**（tags / description / mixed / custom），
 * 每个模式的 LLM 调用**只产出自己那一种**。
 *
 * 改这一层的动因（v2.4 之后仍存在的问题）：
 *   ① 三模式此前共用**同一个可编辑预设** —— 用户为「只解析标签」调提示词时，
 *      会把「只解析自然语言」那份也一起改掉，两种模式互相污染；
 *   ② 可编辑层里的「任务 9（输出 JSON）」是三模式通用的措辞，
 *      描述模式里仍写着"落成最终 JSON"，模型会顺手把 tags 也吐出来（被丢弃、纯烧 token）；
 *   ③ 「恢复默认提示词」按钮只恢复一份，三种模式拿到的默认文本完全一样。
 *
 * 现在：可编辑层按模式切分（任务 9 换成模式专属措辞 + 追加「本模式产出职责」段），
 * 四份默认模板各自独立，用户可分别改写、分别恢复默认。
 */

/** 输出模式（与 pipeline.ts 的 ExtractMode 同义） */
export type ExtractOutputMode = ExtractMode;

/** v2.6：模式专属的「任务 9」措辞 —— 决定 JSON 里到底要写什么 */
const MODE_TASK9: Record<ExtractOutputMode, string> = {
  tags:
    '输出 JSON：只给出 tags 数组（按下方 schema 的 tags 示例）与必要的主体字段（mainSubject / secondarySubjects / summary / environment / optics 等），**不要输出 description**；把上面 6 段的决策落成最终 JSON，用 <json> 包裹。缺失必填项给合理值，不得输出 null。',
  description:
    '输出 JSON：只给出 description（2~3 句完整英文句子）与必要的主体字段（mainSubject / secondarySubjects / summary / environment / optics 等），**不要输出 tags**；把上面 6 段的决策落成最终 JSON，用 <json> 包裹。缺失必填项给合理值，不得输出 null。',
  mixed:
    '输出 JSON：按下方 schema 字段名严格一致，description 与 tags 都要给出，把上面 6 段的决策落成最终 JSON，用 <json> 包裹。缺失必填项给合理值，不得输出 null。',
  custom:
    '输出 JSON：只给出 prompt 字段（完整最终提示词，含 \\nBREAK\\n 分段），可选 notes 字段。不受 schema 约束，插件直接提取 prompt 送生图。缺失必填项给合理值，不得输出 null。',
};

/** v2.6：模式专属的「本模式产出职责」段（可编辑层，用户可删改） */
const MODE_OUTPUT_ROLE: Record<ExtractOutputMode, string[]> = {
  tags: [
    '# 本模式产出职责（只产出这一种，不要越界）',
    '- 本次**主产出 Danbooru 标签**（Hard Tags）：插件会把它渲染成「单行、逗号分隔」的标签段。',
    '- **description 可选（极简增量）**：仅当标签无法表达空间/光影/动作状态/文字时，输出 1-2 个短语片段（非句子、无主谓、逗号分隔、无句号），渲染时直接追加在 tags 段后。',
    '- 标签段要能独立成图：身份与数量、外观、服装、场景、动作、镜头、光影、以及缺失类标签（faceless / head out of frame / no bra）都要覆盖。',
  ],
  description: [
    '# 本模式产出职责（只产出这一种，不要越界）',
    '- 本次**主产出自然语言描述**（Natural Language）：插件会把它渲染成「2~3 句完整英文句子」的段落，按三层结构：①主体姿态 ②互动空间 ③环境光影收束。',
    '- **不要输出 tags / 标签数组**：插件在本模式不读取，输出了会被整段丢弃、纯属浪费 token。',
    '- **必须填写隐性结构化字段**（mainSubject/secondarySubjects/optics/environment 等）：供程序校正景别裁剪、生成人数标签、镜头参数对齐。这些字段虽不直接渲染，但决定程序如何理解你的句子。',
    '- 句子要能独立成图：主体动作、视线、角色交互、姿态、镜头、空间关系、光影质感、画面文字都要覆盖；身份/外观/数量用指代短语（the black-haired woman in uniform）代替罗列。',
  ],
  mixed: [
    '# 本模式产出职责（两段都要，严格分工）',
    '- 本次产出**双表示**：`tags`（第一层 Hard Tags：身份/数量/外观/服装/场景/动作/镜头/光影/文字）+ `description`（第二层 Natural Language：主体姿态/角色互动/空间关系/光影质感/画面文字）。',
    '- **自然语言优先**：description 承担空间关系、光影质感、动作状态、画面文字；tags 只写身份/数量/外观/服装/场景/动作/镜头/光影/文字音效。',
    '- 两段**不得重复同一信息**：description 不再复述 tags 已写的外观与服装；tags 不写完整英文句子。',
    '- **自然语言三层结构**：① 主体身份+核心外观+静态姿态+视线 ② 其他角色位置/特征+交互关系+空间层级 ③ 关键镜头/环境锚点+主光源阴影收束；无必要信息不强行补全。',
    '- **多角色隔离**：特征物理相邻、独占特征按区分度给、三人以上给明确位置、双人互动写静态关系、非焦点角色按可见性处理（faceless/head out of frame/male face out of frame/solo focus 语义不同不可互换）。',
    '- 插件会把两段重排为「Hard Tags 段在前，Natural Language 段在后」。',
  ],
  custom: [
    '# 本模式产出职责（完全自定义，插件不干预）',
    '- **插件不注入任何规范、契约、固定层**——用户预设即完整系统提示词。',
    '- **LLM 输出格式任意**：纯文本 / JSON({prompt,notes}) / <thinking>+<json> 均可，插件自动提取 prompt 字段。',
    '- **后处理管线旁路**：LLM 返回内容原样作为最终 prompt，不走标签层/格式化/合成。',
    '- **用户自负**：需自行保证含安全分级、人数标签、主体外观、景别等关键要素；缺失导致出图异常不由插件兜底。',
  ],
};

/**
 * v2.6：可编辑层的公共构造（模板版 / 程序版共用）。
 * @param povPlaceholder true = 用 {pov_section}/{narrator_section} 占位（可复制粘贴的模板）
 */
function buildEditableCore(
  isPov: boolean,
  narratorName: string,
  mode: ExtractOutputMode,
  povPlaceholder: boolean,
): string[] {
  const parts: string[] = [...COMMON_RULES];
  // v2.6：把通用的「任务 9」换成模式专属措辞（只产出本模式那一种输出）
  const t9 = parts.findIndex(l => l.startsWith('输出 JSON：'));
  if (t9 >= 0) parts.splice(t9, 1, MODE_TASK9[mode]);
  if (povPlaceholder) {
    parts.push('{pov_section}', '{narrator_section}');
  } else {
    parts.push(...(isPov ? POV_SECTION : NON_POV_SECTION));
    if (isPov && narratorName) {
      parts.push(
        '',
        '# 叙述者排除（最高优先级，必须遵守）',
        `叙述者是【${narratorName}】= 相机本身。画面里绝不能出现【${narratorName}】：mainSubject、secondarySubjects、summary 都必须只包含"我"看到的人。即使角色信息里有【${narratorName}】的外观，也一律忽略、不得输出。`,
      );
    }
  }
  // v2.4：多角色隔离规范（三模式共用，属于可编辑层 —— 用户可自行删减）
  parts.push('', ...MULTI_CHARACTER_BLOCK);
  // v2.6：模式专属的产出职责
  parts.push('', ...MODE_OUTPUT_ROLE[mode]);
  return parts;
}

/**
 * v2.4：三层结构
 * ------------------------------------------------------------
 *   [可编辑层]  COMMON_RULES + POV 段 + 叙述者排除 + 多角色隔离
 *               ← 「恢复默认预设」按钮粘贴的就是这一层；用户可整段改写
 *   [固定层]    模式提示 + 模式专属规范 + 全局输出禁令
 *               ← 与模式相关，用户不可关闭（保证三模式的职责边界不丢）
 *   [契约层]    输出格式契约（promptPreset 追加）
 *
 * v2.4 之前的问题：模式专属规范只出现在「内置默认模板」里。
 * 用户一旦在预设框里改写（哪怕只是照抄默认模板），规范就整段消失 ——
 * 标签顺序、权重纪律、散文语法全部失效。
 * 现在把「可编辑层」与「固定层」拆开：无论预设是否被改写，固定层都会追加。
 *
 * v2.6：可编辑层**按模式切分**（三份提示词各自独立）。
 */
export function buildExtractEditableLayer(
  isPov: boolean,
  narratorName: string,
  mode: ExtractOutputMode = "mixed",
): string[] {
  return buildEditableCore(isPov, narratorName, mode, false);
}

/** v2.4：固定层（与模式相关，用户不可关闭） */
export function buildModeFixedLayers(outMode: "description" | "tags" | "mixed" | "custom", isPov: boolean): string[] {
    if (outMode === "custom") return []; // custom 模式无固定层
    const modeHint = outMode === "tags"
        ? "\n# 本次输出模式：只解析 Danbooru 标签 —— tags 必填，description 不要输出（会被丢弃）"
        : outMode === "mixed"
            ? "\n# 本次输出模式：混合式（默认，Anima Hybrid）—— description（动作/关系/空间/光影）与 tags（外观/身份/数量）都必填，且严格分工"
            : "\n# 本次输出模式：只解析自然语言描述 —— description 必填，tags 不要输出（会被丢弃）";
    const povLine = isPov ? SCHEMA_POV : [];
    return [
        '',
        '# ▼▼▼ 固定规范区（优先于上面的可编辑预设部分） ▼▼▼',
        '# 若上方的可编辑预设与本区冲突，一律以本区为准。',
        ...buildModeRules(outMode),
        ...TASK_DETAIL_LINES,
        '',
        ...PROMPT_OUTPUT_EXCLUSIONS,
        '',
        modeHint,
        '',
        ...SCHEMA_HEAD,
        ...povLine,
        ...buildSchemaDual(outMode),
        ...SCHEMA_TAIL,
    ];
}

/**
 * v2.2：内置默认预设的**可编辑模板**（含占位符）。
 * 「恢复默认提示词」按钮把它粘贴进文本框，用户可复制或直接在此基础上改写；
 * 组装时 {pov_section} / {narrator_section} 会被替换为对应段落。
 *
 * v2.4：只含**可编辑层**（推理链 + POV 占位 + 多角色隔离）；
 * 模式专属规范与全局输出禁令是固定层，由 buildExtractSystemPrompt 追加，
 * 不再随预设改写而丢失。
 *
 * v2.6：**按模式各出一份**（tags / description / mixed / custom），四份互不影响；
 * 旧签名 `buildExtractPresetTemplate()` 仍返回 mixed 版（向后兼容）。
 * custom 模式：强制要求仅输出 <thinking>+<json> 格式，禁止任何前置/后置文本。
 */
export function buildExtractPresetTemplate(mode: ExtractOutputMode = "mixed"): string {
    if (mode === "custom") {
        return `你是 AI 图像提示词工程师。从小说片段锁定一个单一静态画面，输出结构化 JSON。

# 输出格式契约（强制，最高优先级）
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
- 第一字符必须是 <，最后字符必须是 >，中间只能有 thinking/json 标签`;
    }
    return buildEditableCore(false, "", mode, true).join('\n');
}

/** v2.4：完整的第一阶段系统提示词（可编辑层 + 固定层；不含输出契约与标签候选） */
export function buildImagePromptSystemPrompt(
    isPov: boolean,
    narratorName: string,
    outMode: "description" | "tags" | "mixed" | "custom" = "mixed",
): string {
    return [
        ...buildExtractEditableLayer(isPov, narratorName, outMode),
        ...buildModeFixedLayers(outMode, isPov),
    ].join('\n');
}

/** v1.9 兜底：剔除最终 prompt 中偶发混入的中文/CJK 标点（规则引擎输出本应纯英文） */
export function stripChineseFallback(text: string): string {
  return toHalfWidth(text)
      .replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, '')
      .replace(/[ \t]+/g, ' ').trim();
}
