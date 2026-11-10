# UI_STANDARD.md — UI Implementation Standards

> Status: Frozen
>
> Level: L2 (Constraint)
>
> Last Updated: 2026-07-24

本项目 UI 标准。所有 AI 在新增或修改 UI 代码时必须遵循。

---

## 1. ST CSS Framework — Available Classes

### Layout

| Class | CSS Equivalent | Purpose |
|-------|---------------|---------|
| `flex-container` | `display:flex; gap:5px; flex-wrap:wrap` | Default flex row |
| `flex1` | `flex:1` | Flexible grow |
| `flexGrow` | `flex-grow:1` | Explicit grow only |
| `flexShrink` | `flex-shrink:1` | Explicit shrink only |
| `flexnowrap` / `flexNoWrap` | `flex-wrap:nowrap` | No-wrap row |
| `flexFlowColumn` | `flex-flow:column` | Column layout |
| `flexWrap` | `flex-wrap:wrap` | Explicit wrap |
| `alignitemscenter` / `alignItemsCenter` | `align-items:center` | Vertical centering |
| `justifySpaceBetween` | `justify-content:space-between` | Spread items |
| `gap0` | `gap:0 !important` | Remove gap |
| `flexBasis48p` | `flex-basis:48%` | Half-width column |
| `expander` | `flex-grow:1` | Spacer |

### Forms

| Class | Purpose |
|-------|---------|
| `text_pole` | Text input / select / textarea (themed bg + border) |
| `textarea_compact` | Smaller textarea font + line-height |
| `autoSetHeight` | Auto-growing textarea (`field-sizing:content`, max 50vh) |
| `neo-range-slider` | Themed range slider |
| `neo-range-input` | Range slider number companion |

### Buttons

| Class | Purpose |
|-------|---------|
| `menu_button` | Standard action button (themed, grayscale(0.5), filter on hover) |
| `menu_button_icon` | Button with icon + text (`gap:5px`) |

### Containers

| Class | Purpose |
|-------|---------|
| `inline-drawer` | Collapsible settings section |
| `inline-drawer-header` | Drawer toggle bar (also gets `.inline-drawer-toggle`) |
| `inline-drawer-content` | Drawer expandable area (`display:none` by default) |
| `inline-drawer-icon` | Chevron toggle icon |
| `extension_container` | Root wrapper for extension panel sections (`display:contents`) |
| `checkbox_label` | Checkbox + label wrapper (row, gap:5px) |

### Utilities

| Class | CSS | Purpose |
|-------|-----|---------|
| `wide100p` | `width:100%` | Full width |
| `margin0` | `margin:0` | Zero margin |
| `marginBot5` | `margin-bottom:5px !important` | Bottom spacing |
| `marginTopBot5` | `margin-top:5px !important; margin-bottom:5px !important` | Vertical spacing |
| `marginTop5` | `margin-top:5px !important` | Top spacing |

---

## 2. Settings Panel Structure

All settings sections MUST use the inline-drawer pattern:

```html
<div class="extension_container">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <span>Section Title</span>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <!-- controls -->
        </div>
    </div>
</div>
```

Rules:
- `inline-drawer-toggle` + `inline-drawer-header` on the same div
- Chevron: `fa-solid fa-circle-chevron-down` with class `down`
- Content is hidden by default (ST JS handles toggle)
- Do NOT invent any other collapse pattern

---

## 3. Tab System (v0.8+)

### Structure

```html
<div class="image-st-tabs">
    <span class="image-st-tab active" data-tab="comfyui">Tab A</span>
    <span class="image-st-tab" data-tab="other">Tab B</span>
</div>
<div class="image-st-tab-content" data-tab="comfyui">...</div>
<div class="image-st-tab-content" data-tab="other" style="display:none">...</div>
```

### CSS (injected via JS `<style>`, DOMPurify strips from templates)

```css
.image-st-tabs {
    display: flex;
    gap: 4px;
    background: var(--black30a);
    padding: 4px;
    border-radius: 8px;
    margin-bottom: 8px;
    flex-shrink: 0;
}
.image-st-tab {
    padding: 6px 12px;
    cursor: pointer;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--SmartThemeBodyColor);
    opacity: 0.6;
    font-size: calc(var(--mainFontSize) * 0.9);
    font-weight: 500;
    transition: all 0.2s;
    user-select: none;
}
.image-st-tab:hover {
    opacity: 0.9;
}
.image-st-tab.active {
    opacity: 1;
    background: var(--white30a);
    box-shadow: 0 1px 2px var(--SmartThemeShadowColor);
}
.image-st-tab-content {
    border: 1px solid var(--SmartThemeBorderColor);
    padding: 8px;
    border-radius: 10px;
    background-color: var(--black30a);
}
```

### Switching (pure JS)

```js
const activateTab = (tabId) => {
    const target = tabBar.querySelector(`.image-st-tab[data-tab="${tabId}"]`);
    if (!target) return;
    tabBar.querySelectorAll(".image-st-tab").forEach(t => t.classList.remove("active"));
    target.classList.add("active");
    settingsContainer.querySelectorAll(".image-st-tab-content").forEach(c => {
        c.style.display = c.getAttribute("data-tab") === tabId ? "" : "none";
    });
};
```

Rules:
- `data-tab` attribute is the link between tab button and content panel
- Only one `.image-st-tab.active` and one visible `.image-st-tab-content`
- Must call `activateTab("defaultId")` after CSS injection to set correct initial state
- All selectors must be scoped to plugin container (`#image_st_settings`) to avoid cross-extension conflicts
- Pure JS only — no jQuery, no framework
- CSS injected via `<style>` in JS (DOMPurify strips `<style>` from Handlebars)

---

## 4. Theme Variables

| Variable | When to Use |
|----------|-------------|
| `var(--SmartThemeBodyColor)` | Primary text, slider track color |
| `var(--SmartThemeEmColor)` | Muted / secondary text, placeholders |
| `var(--SmartThemeQuoteColor)` | Accent highlight |
| `var(--SmartThemeBlurTintColor)` | Button / panel surface backgrounds |
| `var(--SmartThemeBorderColor)` | All borders, separators |
| `var(--SmartThemeShadowColor)` | Drop shadows |
| `var(--black30a)` | Input / drawer content backgrounds, tab bar bg |
| `var(--white30a)` | Hover state, active tab background |
| `var(--black50a)` | Medium shadow / overlay |
| `var(--mainFontSize)` | Font-size anchor (always via `calc()`) |
| `var(--mainFontFamily)` | Primary font stack |
| `var(--active)` | Active / on-state indicator (green) |

**Forbidden — never hardcode:**
```css
/* NEVER: */
color: #888;
background: #2d2d30;
border: 1px solid #444;
```

---

## 5. Dynamic DOM — className vs inline style

### Rule

Prefer `className` whenever an ST class exists.

✅ Correct:
```js
el.className = 'flex-container alignitemscenter';
```

❌ Wrong (class exists):
```js
el.style.cssText = 'display:flex;gap:5px;align-items:center;';
```

### Inline style allowlist

Only these patterns are permitted for `style.cssText`:

| Situation | Example |
|-----------|---------|
| Dynamic pixel width | `el.style.width = '80px'` |
| Dynamic min-width | `el.style.minWidth = '120px'` |
| Small label text | `el.style.cssText = 'font-size:12px;white-space:nowrap;'` |
| Gap/margin override (no utility) | `el.style.cssText = 'gap:6px;margin:4px 0;flex-wrap:wrap;'` |
| Delete button styling | `el.style.cssText = 'padding:2px 6px;font-size:12px;color:red;'` |
| Hint / footnote text | `el.style.cssText = 'color:#888;font-size:12px;'` |

If the same ad-hoc pattern appears 3+ times, extract a CSS class.

---

## 6. Form Controls

### Checkbox

```html
<label class="checkbox_label">
    <input type="checkbox" id="my-setting">
    <span>Label</span>
</label>
```

### Textarea

```html
<textarea id="my-setting" class="text_pole textarea_compact autoSetHeight" rows="3"></textarea>
```

### Range slider pair

```html
<div class="alignitemscenter flex-container flexFlowColumn flexGrow flexShrink gap0 flexBasis48p">
    <input id="my-slider" class="neo-range-slider wide100p" type="range" min="1" max="30" step="1" value="20">
    <input id="my-slider-value" class="neo-range-input" type="number" min="1" max="30">
</div>
```

Always use the six-class combo on the slider wrapper.

### Select

```html
<select id="my-select" class="text_pole">
    <option value="a">Option A</option>
</select>
```

Use `populateSelect(select, items, value)` for dynamic options, `bindSelect()` for events.

### Number input

```html
<input id="my-number" class="text_pole" type="number" min="0" max="9999">
```

Use `bindNum()` for events.

---

## 7. Handlebars Templates

### Conventions

- All control IDs use plugin prefix: `{{prefix}}_control_name` → `image_st_control_name`
- Template variables: lowercase with underscores (`{{steps}}`, `{{model}}`)
- Rendering:
  ```js
  const html = await renderExtensionTemplateAsync('third-party/image-st', 'settings', model);
  container.insertAdjacentHTML('beforeend', html);
  ```
- Labels use `data-i18n` where applicable

---

## 8. Forbidden Patterns

| Pattern | Why |
|---------|-----|
| Hardcoded colors | Breaks theme switching |
| Inline `display:flex` when `flex-container` exists | Redundant, inconsistent |
| Any collapse pattern other than `inline-drawer` | Inconsistent with ST ecosystem |
| jQuery | Plugin uses vanilla JS |
| Framework tab systems | Must use pure JS (§3) |
| `.right_menu_button` in settings panels | Wrong usage — reserved for right-side menus |
| Empty `class` attributes | Wasteful |
| Duplicate IDs | Breaks `getElementById()` binding |

---

## 9. Best Practices

### Event binding

- Static elements: `document.getElementById('id')`
- Dynamic lists (regex rows, LoRA rows): event delegation via `event.target.closest()`
- Form controls: `bindNum(id, callback)`, `bindText(id, callback)`, `bindSelect(id, callback)`
- Dynamic dropdowns: `populateSelect(selectElement, items, value)`

### Slider → input linking

```js
slider.addEventListener('input', () => { input.value = slider.value; });
input.addEventListener('input', () => { slider.value = input.value; });
```

### Tab content visibility

```js
el.style.display = '';   // show
el.style.display = 'none'; // hide
```

No jQuery `show()`/`hide()`. No fixed CSS `display:none` — use inline style or class.

### Accessibility

- Semantic HTML: `<input>`, `<textarea>`, `<select>`, `<label>`, `<button>`
- Wrap checkboxes in `<label class="checkbox_label">`
- Use `data-i18n` for text labels (when ST i18n is active)

---

## 10. Document Hierarchy

```
UI_STANDARD.md (L2 — constraint)
    defines UI implementation rules that all code must follow
    overrides any L3+ document on UI questions
    equal authority to ARCHITECTURE.md
```
