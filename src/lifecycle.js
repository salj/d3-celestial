// Resources owned by one map. Disposing a map must not affect its neighbours.
export function createLifecycle() {
  let disposed = false;
  const timers = new Set(), requests = new Set(), cleanup = new Set();
  return {
    get disposed() { return disposed; },
    onDispose(fn) {
      if (disposed) fn(); else cleanup.add(fn);
      return () => cleanup.delete(fn);
    },
    schedule(fn, delay, ...args) {
      if (disposed) return;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!disposed) fn(...args);
      }, delay);
      timers.add(timer);
      return timer;
    },
    cancel(timer) { clearTimeout(timer); timers.delete(timer); },
    load(url, callback) {
      if (disposed) return Promise.resolve();
      const controller = new AbortController();
      requests.add(controller);
      return fetch(url, { signal: controller.signal }).then(response => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
        return response.json();
      }).then(
        json => { if (!disposed) callback(null, json); },
        error => { if (!disposed && error.name !== "AbortError") callback(error); }
      ).finally(() => requests.delete(controller));
    },
    loadBytes(url, callback) {
      if (disposed) return Promise.resolve();
      const controller = new AbortController();
      requests.add(controller);
      return fetch(url, { signal: controller.signal }).then(response => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
        return response.arrayBuffer();
      }).then(
        bytes => { if (!disposed) callback(null, new Uint8Array(bytes)); },
        error => { if (!disposed && error.name !== "AbortError") callback(error); }
      ).finally(() => requests.delete(controller));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
      for (const request of requests) request.abort();
      timers.clear(); requests.clear();
      for (const fn of cleanup) fn();
      cleanup.clear();
    }
  };
}
