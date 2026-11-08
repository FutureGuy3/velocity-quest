// トレーニング中に画面が消えないようにする(Screen Wake Lock API。非対応端末では何もしない)
let sentinel = null;
let wanted = false;

async function acquire() {
  if (!wanted || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
  } catch { /* 省電力モードなどで断られたときは何もしない */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wanted && !sentinel) acquire();
});

export function keepScreenOn() { wanted = true; acquire(); }

export function allowScreenOff() {
  wanted = false;
  sentinel?.release().catch(() => {});
  sentinel = null;
}
