// ---------------- 图片源加载（引擎层） ----------------
//
// 为什么单独一个模块：
//
//   照片会从三个地方被请求 —— 缩略图图集、卡片的小图、卡片的大图。
//   同一个 URL 若被并发请求两次，浏览器虽然会合并底层连接，
//   但仍可能触发两次解码；这里做一层 in-flight 去重，
//   保证「同一个 URL 全局只发一次请求、只解码一次」。
//
// 为什么还留一层 LRU：
//   卡片纹理有自己的显存上限（1600px 的纹理一张就 10MB），
//   纹理被淘汰后若重新拉图，用户每捏一张新照片就要等一次网络往返。
//   这里把「已解码的图片元素」多留一会儿，
//   纹理重建时直接复用 —— 不重新下载，也不重新解码。
//
// 解码本身用 decoding='async'，避免大图解码卡住主线程。

const inflight = new Map();
const cache = new Map();

// 已解码图片元素常驻的个数上限。
// 缩略图 400px 解码后约 0.6MB，大图 1024px 约 4MB。
// 留 48 个大致是「全部缩略图 + 少量大图」的量级，内存可控。
const MAX_CACHED = 48;

function touch(url, el) {
  cache.delete(url);
  cache.set(url, el);
}

/**
 * 加载一个图片元素（HTMLImageElement）。
 * 同一 URL 的并发调用共享同一个 Promise；已加载过的直接命中缓存。
 *
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImageEl(url) {
  const cached = cache.get(url);
  if (cached) {
    touch(url, cached);
    return Promise.resolve(cached);
  }

  const inf = inflight.get(url);
  if (inf) return inf;

  const p = new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`图片加载失败：${url}`));
    im.src = url;
  }).then((im) => {
    touch(url, im);
    // 超出上限就丢掉最久没用的那个（Map 保持插入序）
    while (cache.size > MAX_CACHED) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
    return im;
  });

  inflight.set(url, p);
  // 无论成败都要把槽位释放掉，否则失败一次后永远拿不到重试机会
  p.then(() => inflight.delete(url), () => inflight.delete(url));
  return p;
}
