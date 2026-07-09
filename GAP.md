	# WritingModeEditor — Obsidian 体验差距分析

> 基于 `WritingModeEditor.tsx` 的现有实现，对比 Obsidian 逐项分析。
> 回来写代码时直接参考对应章节。

---

## 已完成的部分 ✅

| 功能 | 状态 |
| --- | --- |
| Milkdown + commonmark | ✅ |
| KaTeX 数学公式渲染 | ✅ |
| `[@cite]` autocomplete 基础框架 | ✅ |
| 自动保存 1.5s | ✅ |
| Preview trigger 800ms | ✅ |
| `editor:insert` 事件 | ✅ |
| mathBlockView / mathInlineView | ✅ |
| mathAutoSelectPlugin | ✅ |

---

## 待修复项（已标记，稍后写代码）

> 见 memory 记录，回来说"继续 citation 修复"即可。

**1. Citation dropdown anchor 位置错误**

```typescript
// 现在（错误）：
setCiteAnchor(new DOMRect(coords.left, coords.top, 0, 0))

// 修复：用 bottom 让 dropdown 出现在光标下方
setCiteAnchor(new DOMRect(
    coords.left,
    coords.top,
    0,
    coords.bottom - coords.top  // 真实高度
))
```

**2. Citation autocomplete 触发不稳定**

```typescript
// 现在（不稳定）：监听 DOM input/keyup 事件
container.addEventListener("input", onInput)
container.addEventListener("keyup", onInput)

// 修复：在 listenerCtx.markdownUpdated 里调用 checkCiteTrigger
ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
    contentRef.current = markdown
    updateTabContent(...)
    checkCiteTrigger()  // ← 100% 可靠
    // ... 其他逻辑
})
```

**3. Citation 应做成 ProseMirror NodeView（蓝色标签）**

```typescript
// 目标效果：[@vaswani2017] → [Vaswani 2017] 蓝色标签，atom:true 整体删除
export const citationSchema = $nodeSchema('citation', () => ({
    group: 'inline',
    inline: true,
    atom: true,       // 整体删除，不会误删半个括号
    attrs: { key: { default: '' } },
    // ... parseMarkdown / toMarkdown
}))
```

```css
.citation-tag {
    display:     inline-flex;
    align-items: center;
    padding:     1px 7px;
    border-radius: 4px;
    background:  rgba(74, 142, 255, 0.12);
    color:       #4a8eff;
    font-size:   0.88em;
    font-family: monospace;
    cursor:      pointer;
    user-select: none;
}
```

**4. Citation 数据：替换 hardcoded sample data**

```typescript
// 现在（debug 用）：
useEffect(() => {
    addReference({ bibKey: 'sample2026', ... })
    addReference({ bibKey: 'another2025', ... })
}, [addReference])

// 修复：从后端读取真实数据
useEffect(() => {
    invoke<Citation[]>('list_citations').then(citations => {
        citations.forEach(c => addReference({
            name:    c.title,
            kind:    'bib',
            bibKey:  c.id,
            title:   c.title,
            authors: c.authors,
            year:    c.year,
        }))
    })
}, [])
```

---

---

## 优先级总结

| # | 差距 | 重要性 | 难度 | 预计时间 |
|---|------|--------|------|----------|
| 1 | Citation 三项修复（见上） | ⭐⭐⭐⭐⭐ | 中 | 2-3小时 |
| 2 | 字体/行距/最大宽度 CSS | ⭐⭐⭐⭐⭐ | 低 | 30分钟 |
| 3 | 图片本地渲染（asset://） | ⭐⭐⭐⭐⭐ | 中 | 2小时 |
| 4 | Frontmatter 折叠 | ⭐⭐⭐⭐ | 中 | 3小时 |
| 5 | 代码块语法高亮 | ⭐⭐⭐ | 低 | 30分钟 |
| 6 | 公式点击切换流畅度 | ⭐⭐⭐ | 低 | 1小时 |
| 7 | Typewriter mode | ⭐⭐ | 中 | 2小时 |
| 8 | 链接 Cmd+Click | ⭐⭐ | 低 | 30分钟 |

**建议顺序：** #2（CSS，立刻见效）→ #5（prism，一行代码）→ #8（链接，简单）→ #1（Citation 修复）→ #3（图片）→ #4（Frontmatter）→ #6 → #7

---

*生成于 2026年5月 — TypeStudio WritingModeEditor Obsidian Gap Analysis*
