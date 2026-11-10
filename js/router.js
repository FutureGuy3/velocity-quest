// ハッシュルーター。#/workout/abc?x=1 → { path:'/workout/abc', params:{id:'abc'}, query:{x:'1'} }
const routes = [];
let notFound = null;
let current = null;

/** pattern 例:'/workout/:id' */
export function route(pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:([^/]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  routes.push({ re, keys, handler });
}

export function fallback(handler) { notFound = handler; }

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#/, '') || '/home';
  const [path, qs = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  return { path, query };
}

export function navigate(to, { replace = false } = {}) {
  const hash = to.startsWith('#') ? to : '#' + to;
  if (replace) history.replaceState(null, '', hash);
  else if (location.hash !== hash) { location.hash = hash; return; }
  resolve();
}

let backing = false;
let depth = 0; // アプリ内で進んだ回数(戻る先がアプリ内にあるか判断する)

/** 1つ前の画面へ。アプリを開いた直後など戻る先が無いときは fallbackTo へ */
export function back(fallbackTo = '/home') {
  if (depth > 0) { backing = true; history.back(); }
  else navigate(fallbackTo, { replace: true });
}

async function resolve() {
  const { path, query } = parseHash();
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      current = { path, params, query };
      await r.handler(current);
      return;
    }
  }
  if (notFound) await notFound({ path, query });
}

export function currentRoute() { return current; }

export function startRouter() {
  window.addEventListener('hashchange', (e) => {
    // 戻る操作かどうかは判別できないので、進むときに増やし戻る関数で減らす
    depth = backing ? Math.max(0, depth - 1) : depth + 1;
    backing = false;
    resolve();
  });
  if (!location.hash) history.replaceState(null, '', '#/home');
  resolve();
}
