/**
 * Pesquisa de Logos — Backend (Cloudflare Worker)
 *
 * Endpoints:
 *   GET /resolve?name=...&ctx=...   -> { domain, confianca }   (IA + web search)
 *   GET /logo?domain=exemplo.com.br -> bytes da logo do site (og:image/apple-touch-icon)
 *   GET /img?url=https://...         -> bytes de uma imagem de host conhecido (proxy)
 *
 * Segurança:
 *   - Chave da Anthropic no secret ANTHROPIC_API_KEY (nunca no código).
 *   - Só as origens em ALLOWED_ORIGINS recebem CORS.
 *   - Respostas cacheadas 30 dias (repetições saem de graça).
 */

const ALLOWED_ORIGINS = [
  'https://tailorexec.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:5500',
];

const IMG_HOSTS = [
  'logo.clearbit.com', 'unavatar.io', 'icon.horse',
  't0.gstatic.com', 't1.gstatic.com', 't2.gstatic.com', 't3.gstatic.com', 'www.google.com',
];

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), origin);
    try {
      if (url.pathname === '/resolve') return await handleResolve(req, env, ctx, origin);
      if (url.pathname === '/logo')    return await handleLogo(req, ctx, origin);
      if (url.pathname === '/img')     return await handleImg(req, ctx, origin);
      return cors(text('Pesquisa de Logos backend. Endpoints: /resolve?name= , /logo?domain= , /img?url='), origin);
    } catch (e) {
      return cors(json({ error: String(e && e.message || e) }, 500), origin);
    }
  },
};

// ---------- CORS / helpers ----------
function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
function cors(res, origin) { const h = corsHeaders(origin); for (const k in h) res.headers.set(k, h[k]); return res; }
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } }); }
function text(s, status = 200) { return new Response(s, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
const cleanDomain = d => (d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[\/?#]/)[0];

// ---------- /resolve (nome -> domínio via IA + busca) ----------
async function handleResolve(req, env, ctx, origin) {
  const p = new URL(req.url).searchParams;
  const name = (p.get('name') || '').trim();
  const context = (p.get('ctx') || '').trim().slice(0, 120);
  if (!name) return cors(json({ error: 'missing name' }, 400), origin);
  if (name.length > 120) return cors(json({ error: 'name too long' }, 400), origin);

  const cache = caches.default;
  const cacheKey = new Request('https://cache.local/resolve?n=' + encodeURIComponent(name.toLowerCase()) + '&c=' + encodeURIComponent(context.toLowerCase()));
  const hit = await cache.match(cacheKey);
  if (hit) return cors(new Response(hit.body, hit), origin);

  const result = await searchDomain(name, context, env);
  const res = json(result);
  res.headers.set('Cache-Control', 'public, max-age=2592000');
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return cors(res, origin);
}

async function searchDomain(name, context, env) {
  if (!env.ANTHROPIC_API_KEY) return { domain: '', confianca: 'baixa', error: 'no api key' };
  const ctxLine = context
    ? `Contexto importante (use para desambiguar): ${context}.`
    : `A empresa é brasileira.`;
  const body = {
    model: 'claude-haiku-4-5',
    max_tokens: 350,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    messages: [{
      role: 'user',
      content:
        `Encontre o site OFICIAL da empresa "${name}". ${ctxLine} ` +
        `Pesquise na web para confirmar que é a empresa certa (do contexto), não um homônimo de outro país/setor. ` +
        `Responda APENAS com um JSON exatamente nesta forma: {"domain":"exemplo.com.br","confianca":"alta"} ` +
        `— domain sem http e sem www; confianca deve ser alta, media ou baixa. ` +
        `Se não tiver certeza ou não encontrar, responda {"domain":"","confianca":"baixa"}.`,
    }],
  };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    return { domain: '', confianca: 'baixa', error: `anthropic ${r.status} ${t.slice(0, 140)}` };
  }
  const data = await r.json();
  const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ');
  let domain = '', confianca = 'baixa';
  const m = txt.match(/\{[^{}]*\}/);
  if (m) { try { const o = JSON.parse(m[0]); domain = (o.domain || '').trim(); confianca = (o.confianca || 'baixa').trim(); } catch (e) {} }
  if (!domain) { const d = txt.match(/([a-z0-9-]+\.)+[a-z]{2,}(\.[a-z]{2,})?/i); if (d) domain = d[0]; }
  return { domain: cleanDomain(domain), confianca };
}

// ---------- /logo (extrai a logo do site da empresa) ----------
async function handleLogo(req, ctx, origin) {
  const domain = cleanDomain(new URL(req.url).searchParams.get('domain') || '');
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return cors(json({ error: 'bad domain' }, 400), origin);

  const cache = caches.default;
  const cacheKey = new Request('https://cache.local/logo?d=' + encodeURIComponent(domain));
  const hit = await cache.match(cacheKey);
  if (hit) return cors(new Response(hit.body, hit), origin);

  const logoUrl = await extractLogoUrl(domain);
  let res;
  if (logoUrl) {
    const img = await fetch(logoUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (logo-fetcher)' }, cf: { cacheTtl: 2592000 } }).catch(() => null);
    const ct = img && img.ok ? (img.headers.get('Content-Type') || '') : '';
    if (img && img.ok && /image\//i.test(ct)) {
      res = new Response(img.body, { status: 200, headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=2592000' } });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return cors(res, origin);
    }
  }
  // nada encontrado: 404 com cache curto (não refazer toda hora)
  res = json({ error: 'no logo' }, 404);
  res.headers.set('Cache-Control', 'public, max-age=86400');
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return cors(res, origin);
}

async function extractLogoUrl(domain) {
  for (const base of [`https://${domain}/`, `https://www.${domain}/`]) {
    try {
      const r = await fetch(base, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'text/html' }, cf: { cacheTtl: 86400 }, redirect: 'follow' });
      if (!r.ok) continue;
      const html = (await r.text()).slice(0, 300000);
      const finalUrl = r.url || base;
      const cand =
        linkIcon(html, true) ||   // apple-touch-icon (logo quadrada, preferida)
        metaContent(html, 'og:image') ||
        metaContent(html, 'og:image:url') ||
        metaContent(html, 'twitter:image') ||
        metaContent(html, 'twitter:image:src') ||
        linkIcon(html, false);    // icon comum (maior)
      if (cand) { try { return new URL(cand, finalUrl).href; } catch (e) {} }
    } catch (e) { /* tenta www */ }
  }
  return '';
}

function metaContent(html, prop) {
  const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\'][^>]*>', 'i');
  const tag = html.match(re);
  if (!tag) return '';
  const c = tag[0].match(/content=["']([^"']+)["']/i);
  return c ? c[1].trim() : '';
}

function linkIcon(html, apple) {
  const links = html.match(/<link[^>]+>/ig) || [];
  let best = '', bestN = -1;
  for (const l of links) {
    const isApple = /rel=["'][^"']*apple-touch-icon[^"']*["']/i.test(l);
    const isIcon = /rel=["'][^"']*\bicon\b[^"']*["']/i.test(l) && !isApple;
    if (apple ? !isApple : !isIcon) continue;
    const href = (l.match(/href=["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    const sz = (l.match(/sizes=["'](\d+)x\d+["']/i) || [])[1];
    const n = sz ? parseInt(sz, 10) : (apple ? 60 : 16);
    if (n > bestN) { bestN = n; best = href; }
  }
  return best;
}

// ---------- /img (proxy de imagem de hosts conhecidos) ----------
async function handleImg(req, ctx, origin) {
  const target = new URL(req.url).searchParams.get('url');
  if (!target) return cors(json({ error: 'missing url' }, 400), origin);
  let host = '';
  try { host = new URL(target).hostname; } catch (e) { return cors(json({ error: 'bad url' }, 400), origin); }
  if (!IMG_HOSTS.includes(host)) return cors(json({ error: 'host not allowed' }, 400), origin);

  const cache = caches.default;
  const cacheKey = new Request('https://cache.local/img?u=' + encodeURIComponent(target));
  const hit = await cache.match(cacheKey);
  if (hit) return cors(new Response(hit.body, hit), origin);

  const upstream = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 (logo-fetcher)' }, cf: { cacheTtl: 2592000 } });
  if (!upstream.ok) return cors(json({ error: 'upstream ' + upstream.status }, 502), origin);
  const res = new Response(upstream.body, {
    status: 200,
    headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'image/png', 'Cache-Control': 'public, max-age=2592000' },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return cors(res, origin);
}
