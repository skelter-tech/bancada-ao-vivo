// Cliente mínimo do Firestore pela API REST, autenticado pela conta de serviço.
// Sem SDK: só WebCrypto, que existe igual no Node 22 e nas funções do Vercel.
// A biblioteca oficial puxaria dezenas de pacotes para quatro operações.
//
// Entrada: o JSON da conta de serviço (o arquivo .chave-firebase.json), passado
// como texto. No Actions e no Vercel ele vem de um segredo, nunca do código.

const b64url = (buf) => {
  const s = typeof buf === 'string' ? buf : String.fromCharCode(...new Uint8Array(buf));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const utf8b64url = (txt) => b64url(String.fromCharCode(...new TextEncoder().encode(txt)));

function pemParaDer(pem) {
  const corpo = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(corpo), (c) => c.charCodeAt(0));
}

export function conectar(jsonConta) {
  const conta = typeof jsonConta === 'string' ? JSON.parse(jsonConta) : jsonConta;
  const projeto = conta.project_id;
  const BASE = `https://firestore.googleapis.com/v1/projects/${projeto}/databases/(default)/documents`;
  let token = null; let expira = 0;

  // troca uma assinatura da conta de serviço por um token de acesso de 1 hora
  async function acesso() {
    if (token && Date.now() < expira - 60000) return token;
    const agora = Math.floor(Date.now() / 1000);
    const cab = utf8b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const corpo = utf8b64url(JSON.stringify({ iss: conta.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600 }));
    const chave = await crypto.subtle.importKey('pkcs8', pemParaDer(conta.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', chave, new TextEncoder().encode(`${cab}.${corpo}`));
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${cab}.${corpo}.${b64url(sig)}` }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`Firestore: login da conta de serviço recusado (${j.error || r.status})`);
    token = j.access_token; expira = Date.now() + j.expires_in * 1000;
    return token;
  }

  // Tudo é gravado como um campo de texto JSON: mapear cada tipo para o formato
  // do Firestore seria código para nada, porque ninguém consulta dentro do estado.
  const empacota = (obj, extras = {}) => ({ fields: { json: { stringValue: JSON.stringify(obj) }, ...extras } });
  const desempacota = (doc) => (doc?.fields?.json?.stringValue ? JSON.parse(doc.fields.json.stringValue) : null);

  async function req(metodo, caminho, corpo) {
    const r = await fetch(`${BASE}/${caminho}`, {
      method: metodo,
      headers: { authorization: `Bearer ${await acesso()}`, 'content-type': 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (r.status === 404 && metodo === 'GET') return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Firestore ${metodo} ${caminho}: HTTP ${r.status} ${j.error?.message || ''}`);
    return j;
  }

  return {
    projeto,
    async grava(caminho, obj, extras) { await req('PATCH', caminho, empacota(obj, extras)); },
    async le(caminho) { return desempacota(await req('GET', caminho)); },
    async apaga(caminho) { await req('DELETE', caminho); },
    // lista os documentos de uma coleção pelo campo numérico "numero", do maior para o menor
    async listaPorNumero(colecao, limite = 200) {
      const r = await fetch(`${BASE}:runQuery`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await acesso()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: colecao }], orderBy: [{ field: { fieldPath: 'numero' }, direction: 'DESCENDING' }], limit: limite } }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(`Firestore consulta ${colecao}: HTTP ${r.status}`);
      return j.filter((x) => x.document).map((x) => desempacota(x.document));
    },
  };
}
