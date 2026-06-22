# 🔎 Pesquisa de Logos em Lote

Ferramenta web (um único arquivo, sem instalação) para buscar e baixar logos de empresas em lote.

## Como usar
1. Cole uma lista de empresas (uma por linha) — pode ser o **nome** (`Nubank`) ou o **domínio** (`nubank.com.br`).
2. Clique em **Buscar logos** — o domínio de cada empresa é resolvido automaticamente (Clearbit autocomplete).
3. Revise/corrija os domínios se necessário (campo editável).
4. Clique em **Baixar todas (ZIP)** para salvar os PNGs.

## Fontes
- **Domínio:** Clearbit autocomplete (grátis, sem chave).
- **Logo:** Google favicon (256px) com fallback em icon.horse; download via proxies CORS.

## Recurso opcional de IA
As empresas que o Clearbit não encontra ficam marcadas como **"verificar"**. O botão **✨ Completar com IA**
usa o modelo **Claude Haiku 4.5 + busca na web** para descobrir o domínio oficial.

> ⚠️ A IA exige que **cada usuário** cole a **própria chave** da API Anthropic. A chave fica salva
> apenas no navegador de quem a digita (`localStorage`) e nunca é compartilhada. O site é estático —
> nenhuma chave fica embutida no código.

## Limitações
- O download em lote depende de proxies CORS públicos gratuitos, que podem oscilar. Se o ZIP falhar,
  use o link **"abrir"** de cada linha (botão direito → salvar imagem).
