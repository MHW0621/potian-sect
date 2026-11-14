/* 破天宗 · 增量渲染器
 *
 * 以前每个面板都是 `el.innerHTML = html`：不管变了几个字，都把整棵子树拆了重建。
 * 后果有三个，都在实测里量到过：
 *   1. 正在输入的 input 被销毁，光标与输入内容丢失（输入人数 → 1 秒后弹回默认值）
 *   2. 鼠标按下与面板重建撞在同一帧时，点击目标被销毁，这次点击直接丢失
 *   3. 每次重建 900 多个节点，视觉上一直在闪
 *
 * 这里改成 `morph(el, html)`：把模板解析成一棵游离树，与真实树逐层比对，
 * 只改真正变了的那几处 —— 文本改 nodeValue，属性改 attribute，节点就地复用。
 * 输入框、按钮、滚动位置、焦点全都天然保留，因为它们从来没有被销毁。
 */

const SKIP_VALUE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/* 正在编辑或标了 data-keep 的表单控件，不覆盖它的值 */
function keepValue(el) {
  if (!SKIP_VALUE.has(el.tagName)) return false;
  if (el.dataset && el.dataset.keep === '1') return true;
  const ae = document.activeElement;
  if (ae === el) return true;
  /* 焦点还在这个控件内部（比如 select 的 option） */
  return !!(ae && el.contains && el.contains(ae));
}

function morphChildren(from, to) {
  const fArr = Array.from(from.childNodes);
  const tArr = Array.from(to.childNodes);
  const n = Math.max(fArr.length, tArr.length);

  for (let i = 0; i < n; i++) {
    const f = fArr[i];
    const t = tArr[i];
    if (!t) {
      /* 真实树多出来的节点，从尾部删，避免索引错位 */
      while (from.childNodes.length > tArr.length) from.removeChild(from.lastChild);
      break;
    }
    if (!f) {
      from.appendChild(t);
      continue;
    }
    morphNode(f, t);
  }
}

function sameKind(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType === 1) return a.tagName === b.tagName;
  return true;
}

function morphNode(from, to) {
  if (!sameKind(from, to)) {
    from.replaceWith(to);
    return to;
  }

  /* 文本节点：只改内容 */
  if (from.nodeType === 3) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return from;
  }
  if (from.nodeType !== 1) return from;

  /* 属性：多的删、差的改、一样的跳过 */
  const keep = keepValue(from);
  if (from.attributes && from.attributes.length) {
    const names = [];
    for (let i = 0; i < from.attributes.length; i++) names.push(from.attributes[i].name);
    for (const name of names) {
      if (keep && (name === 'value' || name === 'checked' || name === 'selected')) continue;
      if (!to.hasAttribute(name)) from.removeAttribute(name);
    }
  }
  if (to.attributes) {
    for (let i = 0; i < to.attributes.length; i++) {
      const at = to.attributes[i];
      if (keep && (at.name === 'value' || at.name === 'checked' || at.name === 'selected')) continue;
      if (from.getAttribute(at.name) !== at.value) from.setAttribute(at.name, at.value);
    }
  }

  /* 自闭合与表单控件没有可比的子树 */
  if (from.tagName === 'INPUT' || from.tagName === 'BR' || from.tagName === 'HR' || from.tagName === 'IMG') return from;

  morphChildren(from, to);
  return from;
}

/**
 * 把容器 el 的内容就地改成与 html 一致。
 * @returns {{changed:number, reused:number}} 改动与复用的节点数，供测试与调试观察
 */
export function morph(el, html) {
  if (!el) return { changed: 0, reused: 0 };
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const stat = { changed: 0, reused: 0 };

  const before = el.childNodes.length;
  const tplNodes = Array.from(tpl.content.childNodes);
  const liveNodes = Array.from(el.childNodes);
  const n = Math.max(tplNodes.length, liveNodes.length);
  for (let i = 0; i < n; i++) {
    const f = liveNodes[i];
    const t = tplNodes[i];
    if (!t) { while (el.childNodes.length > tplNodes.length) el.removeChild(el.lastChild); break; }
    if (!f) { el.appendChild(t); stat.changed++; continue; }
    const isSame = sameKind(f, t);
    morphNode(f, t);
    if (isSame) stat.reused++; else stat.changed++;
  }
  if (!before && !tplNodes.length) stat.changed = 0;
  return stat;
}

/* 只改一段纯文本（顶栏数字这类），省掉整棵树比对 */
export function setText(id, text) {
  const el = document.getElementById(id);
  if (el && el.textContent !== String(text)) el.textContent = String(text);
  return el;
}

/* 只切一组元素的 class（速度按钮这类），不重建 DOM */
export function setClassAll(selector, cls, match) {
  document.querySelectorAll(selector).forEach((el) => {
    const on = typeof match === 'function' ? match(el) : el.matches(match);
    if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
  });
}
