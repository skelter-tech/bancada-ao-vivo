# Instagram e vídeo para a bancada — levantamento

Levantamento feito em 21/09/2026. Não é código do motor: são notas para decidir
o próximo turno. Preços e limites de terceiros mudam; conferir antes de investir.

Ponto de partida que já existe: o `designer` (`aovivo/motor.mjs:422`) já escreve o
**prompt da imagem**. Falta só gerar a imagem e publicar.

## 1. Post no Instagram — dá, e de graça

A **Instagram Graph API (Content Publishing)** é gratuita. Exige:

- Conta Instagram **Business ou Creator** vinculada a uma Página do Facebook
- App no Meta for Developers + token de longa duração (60 dias, renovável por código)
- Permissões `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`

Fluxo em duas chamadas:

1. `POST /{ig-user-id}/media` com `image_url` + `caption` → devolve um container
2. `POST /{ig-user-id}/media_publish` com o id do container

Suporta feed, carrossel, Reels (`media_type=REELS`) e Stories.
Limite de ~50 publicações por 24h — folgado para o ritmo da bancada.

**A pegadinha:** a API não aceita upload de arquivo, só **URL pública HTTPS**.
Custo zero para isso: commitar a mídia num branch/repo público e servir via
`raw.githubusercontent.com` ou jsDelivr. Sem S3, sem conta paga.

Caminho a evitar: `instagrapi` e similares logam como se fossem o app oficial.
Funciona, é grátis, e é banimento esperando acontecer em algo que roda o dia inteiro.

## 2. Vídeo generativo com API grátis — não existe

Veo, Sora, Kling, Runway, Luma, Pika: todos só com crédito de teste, nenhum com
free tier permanente. É GPU por segundo de vídeo. Ordem de grandeza: **US$ 0,10 a
0,50 por segundo gerado**. Um vídeo de 40s pode custar mais que o mês inteiro do
resto do projeto.

Mas o formato "professor Kuka" não precisa disso: é **boneco 2D com boca animada +
narração**. Isso é composição, não geração — e composição roda em CPU, de graça,
no GitHub Actions.

## 3. Pipeline "professor Kuka" a custo zero

| Etapa | Ferramenta grátis | Observação |
|---|---|---|
| Roteiro (30–60s) | Gemini free (o que já roda) | um agente "roteirista" na `equipe/` |
| Voz (TTS) | **edge-tts** (vozes Microsoft pt-BR: Antônio, Francisca, Thalita) | qualidade alta, sem chave; é não-oficial |
| Voz (reserva) | **Piper** (offline, open source) ou Google Cloud TTS free tier | Piper roda no próprio runner, grátis para sempre |
| Sincronia labial | **Rhubarb Lip Sync** (open source) | lê o `.wav` e devolve visemas (A–H) com timestamp |
| Personagem | 8 PNGs de boca + 1 corpo, gerados uma vez | pode nascer do `designer` da bancada |
| Montagem | **ffmpeg** (já vem no runner) ou **Remotion** (React → vídeo) | ffmpeg troca o PNG da boca por frame conforme os cues |
| Legenda queimada | ffmpeg `subtitles` + `.srt` do roteiro | obrigatório: a maioria assiste sem som |
| Render | GitHub Actions em repo público | minutos ilimitados; CPU dá conta de 60s em 1080×1920 |
| Publicação | Instagram Graph API (Reels) | mesmo fluxo da seção 1 |

Custo total: zero, sem dependência que suma de um dia para o outro — exceto o
edge-tts, que é não-oficial, e por isso o Piper fica de reserva.

**Licença:** Remotion é grátis para pessoa física e empresa pequena, mas exige
licença paga acima disso. ffmpeg puro não tem essa amarra.

Rosto realista falando (Wav2Lip, SadTalker) é open source mas precisa de GPU:
grátis só no Colab, o que quebra a automação. Pago barato: HeyGen ou D-ID, na
casa de US$ 20–30/mês.

## 4. Imagem estática — aí sim sobra opção grátis

- **Pollinations.ai** — HTTP GET, sem chave, sem custo. Melhor ponto de partida.
- **Cloudflare Workers AI** (Flux Schnell) — free tier diário generoso, com chave.
- **Gemini / Imagen** — free tier existe, cota apertada.
- **Carta HTML/SVG renderizada** (Playwright ou resvg) — zero IA, zero custo,
  100% previsível. Para um projeto cujo lema é "o código confere, e não só pede",
  montar o card por template é mais coerente do que pedir a imagem a um modelo.

## 5. Agentes de IA: grátis e pago barato

Grátis, o que sustenta a bancada hoje:

- **Gemini free tier** — já em uso; limite por minuto e por dia **por modelo**
  (o rodízio em `src/llm.mjs:16` já trata disso)
- **Groq free** — rápido, bom para tarefas curtas
- **Cerebras free** — mesma ideia
- **OpenRouter** — tem modelos com sufixo `:free`

Pago barato (Anthropic, US$ por milhão de tokens, tabela de 24/06/2026):

| Modelo | Entrada | Saída |
|---|---|---|
| Claude Haiku 4.5 | 1,00 | 5,00 |
| Claude Sonnet 5 | 2,00 | 10,00 |
| Claude Opus 5 | 5,00 | 25,00 |

Dois cortes que mudam a conta de verdade:

- **Batch API: 50% de desconto.** A bancada não é tempo real, o turno pode esperar.
- **Prompt caching:** leitura em cache sai por ~10% do preço. Os prompts de
  `equipe/` e `elenco/` são fixos e grandes — caso perfeito.

Ordem de grandeza: um post (pesquisa + redação + auditoria) gira em 50–80 mil
tokens de entrada e uns 5 mil de saída. No Haiku, com batch e cache, dá fração de
centavo por post; 20 posts por dia ficariam abaixo de US$ 1/mês. O free tier do
Gemini ainda ganha no preço, mas perde na previsibilidade — são os 429 `PerDay`
que o código já contorna.

## 6. Ordem sugerida

Instagram primeiro: imagem + legenda reaproveitando o post que a bancada já
escreve. São duas peças móveis, e uma delas já existe. O vídeo tem seis, e fica
para o turno seguinte.
