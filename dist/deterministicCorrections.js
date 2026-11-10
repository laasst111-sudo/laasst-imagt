import { COUNT_TAG_RE, SEX_WITH_TAG_RE, DISTANCE_INCOMPATIBLE } from "./constants.js";
/** sexWith 排他 + 性别启发式（从 buildPrompt 提取，B1-6 完成后接入） */
export function enforceSexWithExclusivity(subjects) {
    const warnings = [];
    const males = subjects.filter(p => p.gender === "male").length;
    const females = subjects.filter(p => p.gender === "female").length;
    if (males === 2 && females === 1) {
        for (const p of subjects) {
            if (p.sexWith && p.gender === "female") {
                warnings.push("两男一女场景：已清除女性角色的 sexWith");
                p.sexWith = undefined;
            }
        }
    }
    else if (females === 2 && males === 1) {
        for (const p of subjects) {
            if (p.sexWith && p.gender === "male") {
                warnings.push("两女一男场景：已清除男性角色的 sexWith");
                p.sexWith = undefined;
            }
        }
    }
    let seen = false;
    for (const p of subjects) {
        if (p.sexWith) {
            if (seen) {
                warnings.push("多个 sexWith，已只保留首个");
                p.sexWith = undefined;
            }
            seen = true;
        }
    }
    return warnings;
}
export function applyDeterministicCorrections(input) {
    const warnings = [];
    const tags = [...input.tags];
    // 0) solo vs 多人矛盾消解
    const soloIdx = tags.findIndex(t => /^solo$/i.test(t));
    const multiCount = tags.filter(t => /^(2girls|2boys|3girls|3boys|multiple girls|multiple boys)$/i.test(t));
    if (soloIdx >= 0 && multiCount.length) {
        tags.splice(soloIdx, 1);
        warnings.push(`[人数矛盾] solo 与 ${multiCount.join(",")} 冲突，已移除 solo`);
    }
    // 1) sexWith 排他 + 性别启发式（先处理 subjects，再从 subjects 推导 tags）
    warnings.push(...enforceSexWithExclusivity(input.subjects));
    // 2) 人数冲突解决
    const existingCount = tags.filter(t => COUNT_TAG_RE.test(t) && t.toLowerCase() !== "solo");
    const targetCount = input.countTags.filter(t => t.toLowerCase() !== "solo");
    if (existingCount.length && targetCount.length) {
        const same = existingCount.length === targetCount.length &&
            existingCount.every(t => targetCount.includes(t)) &&
            targetCount.every(t => existingCount.includes(t));
        if (!same) {
            if (input.overrideLlmCountTags) {
                for (const t of existingCount) {
                    const i = tags.indexOf(t);
                    if (i >= 0)
                        tags.splice(i, 1);
                }
                const ratingIdx = tags.findIndex(t => /^(safe|sensitive|nsfw|explicit)$/i.test(t));
                tags.splice(ratingIdx >= 0 ? ratingIdx + 1 : 0, 0, ...targetCount);
                warnings.push(`[人数校正] 覆盖 LLM 直出：${existingCount.join(",")} → ${targetCount.join(",")}`);
            }
            else {
                warnings.push(`[人数校正] LLM 直出 ${existingCount.join(",")} 与规则引擎 ${targetCount.join(",")} 不一致（保留 LLM，如需覆盖请开启 overrideLlmCountTags）`);
            }
        }
    }
    else if (!existingCount.length && targetCount.length) {
        const ratingIdx = tags.findIndex(t => /^(safe|sensitive|nsfw|explicit)$/i.test(t));
        tags.splice(ratingIdx >= 0 ? ratingIdx + 1 : 0, 0, ...targetCount);
        warnings.push(`[人数校正] 补入 ${targetCount.join(",")}`);
    }
    // 3) sexWith 类标签排他（tags 层）
    const sexTags = tags.filter(t => SEX_WITH_TAG_RE.test(t));
    if (sexTags.length > 1) {
        for (let i = 1; i < sexTags.length; i++) {
            const idx = tags.indexOf(sexTags[i]);
            if (idx >= 0)
                tags.splice(idx, 1);
        }
        warnings.push(`[sexWith] 多个 sex with 标签，已只保留 ${sexTags[0]}`);
    }
    // 4) 景别兼容性裁剪（Anima「画面规则」）
    const re = DISTANCE_INCOMPATIBLE[input.distance];
    if (re) {
        const removed = [];
        for (let i = tags.length - 1; i >= 0; i--) {
            if (re.test(tags[i])) {
                removed.push(tags[i]);
                tags.splice(i, 1);
            }
        }
        if (removed.length)
            warnings.push(`[景别校正] ${input.distance} 下移除不兼容标签: ${removed.join(",")}`);
    }
    // 5) POV 校验：非 POV 移除 pov / male pov 标签
    if (!input.isPov) {
        const povTags = tags.filter(t => /^(pov|male pov|female pov)$/i.test(t));
        for (const t of povTags) {
            const i = tags.indexOf(t);
            if (i >= 0)
                tags.splice(i, 1);
        }
        if (povTags.length)
            warnings.push(`[POV校验] 非 POV 场景移除 ${povTags.join(",")}`);
    }
    return { tags, warnings };
}
