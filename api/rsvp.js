// Confirmações de presença — função serverless da Vercel.
//
// POST /api/rsvp   { nome, pessoas, vai }   → grava (ou atualiza) a resposta
// GET  /api/rsvp   header "x-senha"          → devolve a lista para os noivos
//
// Banco: Upstash Redis (Vercel → Storage → Upstash for Redis).
// A Vercel cria sozinha as variáveis KV_REST_API_URL e KV_REST_API_TOKEN.
// Você só precisa criar a variável SENHA_LISTA (senha da página lista.html).

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const CHAVE = 'convite:rsvp';

async function redis(comando) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(comando)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error || 'Redis respondeu ' + r.status);
  return data.result;
}

// "  Maria  José " e "maria jose" viram a mesma chave → reenviar só atualiza
function chaveDoNome(nome) {
  return nome
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

module.exports = async function handler(req, res) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ erro: 'Banco de dados não configurado na Vercel.' });
  }

  try {
    if (req.method === 'POST') {
      let body = req.body || {};
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
      }

      // campo-isca: humanos não veem, robôs preenchem
      if (body.site) return res.status(200).json({ ok: true });

      const nome = String(body.nome || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const vai = body.vai !== false;
      const pessoas = vai ? Math.min(Math.max(parseInt(body.pessoas, 10) || 1, 1), 10) : 0;

      if (nome.length < 2) {
        return res.status(400).json({ erro: 'Escreva seu nome.' });
      }

      const registro = { nome, vai, pessoas, data: new Date().toISOString() };
      await redis(['HSET', CHAVE, chaveDoNome(nome), JSON.stringify(registro)]);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'GET') {
      const senha = process.env.SENHA_LISTA;
      if (!senha) return res.status(500).json({ erro: 'Crie a variável SENHA_LISTA na Vercel.' });
      if (req.headers['x-senha'] !== senha) return res.status(401).json({ erro: 'Senha incorreta.' });

      const bruto = (await redis(['HGETALL', CHAVE])) || [];
      const lista = [];
      for (let i = 1; i < bruto.length; i += 2) {
        try { lista.push(JSON.parse(bruto[i])); } catch (e) {}
      }
      lista.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

      const vao = lista.filter(r => r.vai);
      return res.status(200).json({
        totalPessoas: vao.reduce((s, r) => s + (r.pessoas || 0), 0),
        confirmacoes: vao.length,
        naoVao: lista.length - vao.length,
        lista
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ erro: 'Método não permitido.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: 'Não foi possível salvar agora. Tente de novo.' });
  }
};
