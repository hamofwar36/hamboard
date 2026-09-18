/* Hamboard surface colors. Display-only: no model, storage, editor HTML or palette mutation. */
(() => {
  'use strict';
  const customSelector = '.project-card:not(.has-card-image),.episode-card,.stage,.beat-kicker,.calendar-range-bar,.calendar-desktop-widget-event,.calendar-desktop-widget-quick-tool[data-quick-color],.mindmap-node.custom-color,.mindmap-group-head,.quick-memo-pin';
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const colorCache = new Map();
  let frame = 0, observer;
  const themeSignatures = new WeakMap();

  function rgb(color) {
    if (colorCache.has(color)) return colorCache.get(color);
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const value = [...ctx.getImageData(0, 0, 1, 1).data];
    if (colorCache.size > 512) colorCache.clear();
    colorCache.set(color, value);
    return value;
  }
  function luminance(channels) {
    return channels.slice(0, 3).map(v => {
      const n = v / 255;
      return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
    }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
  }
  function contrast(a, b) {
    const x = luminance(rgb(a)), y = luminance(rgb(b));
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
  }
  function foreground(background) {
    // High-contrast retains its existing accessibility palette.
    if (document.body.dataset.theme === 'high-contrast') {
      const dark = '#15171C', light = '#FFFFFF';
      let result = contrast(background, dark) >= contrast(background, light) ? dark : light;
      if (contrast(background, result) < 4.5 && contrast(background, '#000000') > contrast(background, result)) result = '#000000';
      return result;
    }
    const style = getComputedStyle(document.documentElement);
    const dark = style.getPropertyValue('--text-light').trim();
    const light = style.getPropertyValue('--text-dark').trim();
    // Prefer the shared body inks; only strengthen insufficient contrast.
    let result = contrast(background, dark) >= contrast(background, light) ? dark : light;
    if (contrast(background, result) < 4.5) {
      for (const candidate of ['#15171C', '#FBFBFD']) {
        if (contrast(background, candidate) > contrast(background, result)) result = candidate;
      }
    }
    return result;
  }
  function setToken(element, name, value) {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
  }
  function refreshThemeTokens(body) {
    const style = getComputedStyle(body);
    const signature = ['mode', 'theme', 'themeSwapped'].map(k => body.dataset[k]).join('|') +
      ['primary-base', 'primary-soft', 'secondary-base', 'secondary-soft', 'status-error', 'status-success'].map(k => style.getPropertyValue('--' + k)).join('|');
    if (signature === themeSignatures.get(body)) return;
    themeSignatures.set(body, signature);
    // These final CSS values already contain the theme's original HSL/mix adjustment.
    for (const [background, on] of [['primary-base', 'primary'], ['primary-soft', 'primary-soft'], ['secondary-base', 'secondary'], ['secondary-soft', 'secondary-soft'], ['status-error', 'error-solid'], ['status-success', 'success-solid']]) {
      const value = style.getPropertyValue('--' + background).trim();
      if (value) setToken(body, '--on-' + on, foreground(value));
    }
  }
  function paintSurface(element) {
    const style = getComputedStyle(element);
    let background = element.matches('.stage') ? style.getPropertyValue('--user-contrast-bg').trim() : '';
    if (!background) background = style.backgroundColor;
    // Composite translucent calendar surfaces over their actual painted ancestors.
    // A transparent native desktop ultimately uses the theme surface as a fallback;
    // external wallpaper pixels are outside the document's color model.
    let pixel = rgb(background), parent = element.parentElement;
    const over = (front, back) => {
      const alpha = front[3] / 255, behind = back[3] / 255;
      const total = alpha + behind * (1 - alpha);
      return total ? [...front.slice(0, 3).map((n, i) => (n * alpha + back[i] * behind * (1 - alpha)) / total), total * 255] : [0, 0, 0, 0];
    };
    while (pixel[3] < 255 && parent) { pixel = over(pixel, rgb(getComputedStyle(parent).backgroundColor)); parent = parent.parentElement; }
    if (pixel[3] < 255) pixel = over(pixel, rgb(style.getPropertyValue('--surface').trim()));
    background = `rgb(${pixel.slice(0, 3).join(' ')})`;
    const on = foreground(background);
    const muted = document.body.dataset.theme === 'high-contrast' ? (on === '#FFFFFF' ? '#EEF0F4' : '#292B38') : on;
    setToken(element, '--custom-on', on);
    setToken(element, '--custom-muted', contrast(background, muted) >= 4.5 ? muted : on);
  }
  function refresh(root = document.body) {
    if (!document.body || !root) return;
    refreshThemeTokens(root.matches?.('.split-preview-body') ? root : document.body);
    if (root.matches?.(customSelector)) paintSurface(root);
    root.querySelectorAll?.(customSelector).forEach(paintSurface);
  }
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; refresh(); });
  }
  function applyAppearance(appearance = {}) {
    const body = document.body;
    const lightWidget = body.classList.contains('quick-memo-desktop-widget-window');
    body.dataset.mode = !lightWidget && appearance.mode === 'dark' ? 'dark' : 'light';
    body.dataset.theme = lightWidget && appearance.theme === 'high-contrast' ? 'cotton-candy' : (appearance.theme || 'cotton-candy');
    body.dataset.themeSwapped = String(body.dataset.theme !== 'high-contrast' && !!appearance.themeSwapped);
    for (const [name, value, fallback] of [['primary', appearance.customA, '#D7C0FF'], ['secondary', appearance.customB, '#FFD0AE']])
      document.documentElement.style.setProperty('--custom-' + name, /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback);
    if (appearance.fontFamily) {
      const family = '"' + String(appearance.fontFamily).replace(/["\\\r\n]/g, '') + '"';
      document.documentElement.style.setProperty('--interface-font-family', family + ',"Pretendard","Source Han Serif KR",system-ui,sans-serif');
    } else document.documentElement.style.removeProperty('--interface-font-family');
    refresh();
  }
  function install() {
    refresh();
    observer = new MutationObserver(records => {
      if (records.some(record => {
        if (record.type === 'childList') return [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches?.(customSelector) || node.querySelector?.(customSelector)));
        if (record.target === document.body || record.target === document.documentElement) return true;
        if (!record.target.matches?.(customSelector)) return false;
        // Ignore our foreground assignments. Geometry edits do not trigger full color scans.
        const strip = value => (value || '').replace(/--custom-(?:on|muted)\s*:[^;]+;?/g, '').replace(/(?:left|top|width|height)\s*:[^;]+;?/g, '').trim();
        return record.attributeName !== 'style' || strip(record.oldValue) !== strip(record.target.getAttribute('style'));
      })) schedule();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style', 'data-mode', 'data-theme', 'data-theme-swapped'] });
    // Native windows and ordinary app views use the same resolver after every theme change.
    document.addEventListener('transitionend', event => {
      if (event.propertyName === 'background-color' && event.target.matches?.(customSelector)) paintSurface(event.target);
    });
  }
  window.HamTheme = Object.freeze({ refresh, applyAppearance, foreground, contrast });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
