# Anima 提示词集（Civitai 月榜 Top-20）

本目录存放从 Civitai 抓取并整理的 **Anima 模型**提示词集，供 image-st 的提示词参考 / 回归评测使用。

## 文件

- `anima_prompt_set.json` —— 提示词集本体（由 `fetch_civitai_prompts.mjs` 生成）

## 结构

```jsonc
{
  "generated": "ISO 时间",
  "source": "https://civitai.red",
  "model": "Anima",
  "modelId": 2458426,
  "period": "Month",
  "sort": "Most Reactions",
  "limit": 20,
  "versionCount": 8,          // Anima 的版本数（turbo/aesthetic/base/preview…）
  "collected": 20,            // 实际收录条数
  "skipped": { "noPrompt": 0, "notAnima": 0 },
  "prompts": [
    {
      "id": 123456,
      "modelVersion": "turbo-v1.1",
      "stats": { "likeCount": 1200, "heartCount": 340 },
      "nsfwLevel": 1,
      "tags": ["masterpiece", "best_quality", "1girl", "solo", "black_hair"],  // Hard Tags
      "sentences": ["A young woman kneels on all fours on a wooden bed, ..."],   // Natural Language
      "text": "masterpiece, best_quality, 1girl, ...",
      "raw": "原始 prompt 原文"
    }
  ]
}
```

`tags`（Hard Tags）与 `sentences`（Natural Language）已按 Anima Hybrid 规范拆开，可直接喂给插件的
「生成管线 → 输出模式 = mixed」做对照。

## 抓取方法

Civitai 的图片元数据（`meta.prompt`）**必须鉴权**：未提供 API Token 时接口返回空 `meta`；
且只有作者公开了 *Generation Data* 的图片才会带 prompt。

### 方式 A：Node 直跑（需 Token）

```bash
CIVITAI_TOKEN=<你的 Civitai API Token> node fetch_civitai_prompts.mjs --limit 20
```

Token 获取：civitai.red → 右上角头像 → Settings → API Token（免费）。
直连 Node/PowerShell 可能被风控返回 403（站点对脚本指纹敏感）。

### 方式 B：浏览器内同源执行（推荐，可绕过 403）

1. 打开 `https://civitai.red/models/2458426`（Anima 模型页）
2. F12 → Console，粘贴 `fetch_civitai_prompts.mjs` 全文
3. 执行：

```js
await fetchAnimaPrompts({ token: "<你的 API Token>", limit: 20 })
```

4. 把返回对象保存为 `data/anima_prompt_set.json`

### 过滤规则

- 模型必须 `baseModel === "Anima"`（自动排除 AnimateDiff / Animagine / anima_pencil-XL）
- 图片 `meta.Model` / `meta.resources[].model` 二次确认含 "anima"
- 排序 `sort=Most Reactions`、周期 `period=Month`、跨该模型全部 8 个版本收集并去重
