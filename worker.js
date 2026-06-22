/**
 * Pesquisa de Logos — Backend (Cloudflare Worker)
 *
 * Endpoints:
 *   GET /resolve?name=Construtora%20Racional   -> { domain, confianca }
 *   GET /img?url=https://logo.clearbit.com/...  -> bytes da imagem (com CORS)
 *
 * Segurança:
 *   - A chave da Anthropic fica no secret ANTHROPIC_API_KEY (nunca no código).
 *   - Só as origens em ALLOWED_ORIGINS podem chamar.
 *   - O /img só busca de hosts de logo conhecidos (não vira proxy aberto).
 *   - Respostas são cacheadas por 30 dias (repetições saem de graça).
 *
 * Deploy: ver instruções no README (Cloudflare dashboard ou wrangler).
 */

// >>> Ajuste para o(s) domínio(s) do seu site:
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
      if (url.pathname === '/img')     return await handleImg(req, ctx, origin);
      return cors(text('Pesquisa de Logos backend. Endpoints: /resolve?name= , /img?url='), origin);
    } catch (e) {
      return cors(json({ error: String(e && e.message || e) }, 500), origin);
    }
  },
};

// ---------- CORS ----------
function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
function cors(res, origin) {
  const h = corsHeaders(origin);
  for (const k in h) res.headers.set(k, h[k]);
  return res;
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
function text(s, status = 200) {
  return new Response(s, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

// ---------- /resolve ----------
async function handleResolve(req, env, ctx, origin) {
  const name = (new URL(req.url).searchParams.get('name') || '').trim();
  if (!name) return cors(json({ error: 'missing name' }, 400), origin);
  if (name.length > 120) return cors(json({ error: 'name too long' }, 400), origin);

  const cache = caches.default;
  const cacheKey = new Request('https://cache.local/resolve?name=' + encodeURIComponent(name.toLowerCase()));
  const hit = await cache.match(cacheKey);
  if (hit) return cors(new Response(hit.body, hit), origin);

  const result = await searchDomain(name, env);
  const res = json(result);
  res.headers.set('Cache-Control', 'public, max-age=2592000'); // 30 dias
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return cors(res, origin);
}

async function searchDomain(name, env) {
  if (!env.ANTHROPIC_API_KEY) return { domain: '', confianca: 'baixa', error: 'no api key' };
  const body = {
    model: 'claude-haiku-4-5',
    max_tokens: 350,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    messages: [{
      role: 'user',
      content:
        `Encontre o site OFICIAL da empresa brasileira "${name}" ` +
        `(provavelmente do setor de construção civil / engenharia). ` +
        `Pesquise na web para confirmar. Responda APENAS com um JSON exatamente nesta forma: ` +
        `{"domain":"exemplo.com.br","confianca":"alta"} — domain sem http e sem www; ` +
        `confianca deve ser alta, media ou baixa. ` +
        `Se não tiver certeza ou não encontrar, responda {"domain":"","confianca":"baixa"}.`,
    }],
  };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
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
  domain = domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[\/?#]/)[0].toLowerCase();
  return { domain, confianca };
}

// ---------- /img (proxy confiável de imagem) ----------
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
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'image/png',
      'Cache-Control': 'public, max-age=2592000',
    },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return cors(res, origin);
}
