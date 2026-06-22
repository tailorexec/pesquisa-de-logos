# 🔎 Pesquisa de Logos em Lote

Ferramenta web (um único arquivo, sem instalação) para buscar e baixar logos de empresas em lote, na melhor qualidade disponível.

## Como usar
1. Cole uma lista de empresas (uma por linha) — pode ser o **nome** (`Nubank`) ou o **domínio** (`nubank.com.br`).
2. Escolha o **tamanho mínimo aceito** (descarta favicons/imagens menores).
3. Clique em **Buscar logos** — o domínio é resolvido automaticamente e a melhor logo de cada empresa é localizada.
4. Revise/corrija os domínios marcados como **"verificar"** (campo editável).
5. Clique em **Baixar todas (ZIP)** para salvar as imagens.

## Como encontra a "logo certa"
Para cada empresa, testa fontes da melhor para a pior qualidade, **mede o tamanho real da imagem** e
descarta qualquer coisa menor que o mínimo escolhido (elimina favicons minúsculos):

1. **unavatar.io** — agrega Clearbit, Twitter, apple-touch-icon e outras fontes (logos reais, CORS liberado).
2. **Clearbit Logo** — logo oficial em alta resolução.
3. **icon.horse** — melhor ícone disponível do site.
4. **Google favicon 256px** — último recurso.

A coluna **Status** mostra o tamanho da logo encontrada (ex.: `256px`).

## Limitações
- O download em lote depende de proxies CORS públicos gratuitos, que podem oscilar. Se o ZIP falhar,
  use o link **"abrir"** de cada linha (botão direito → salvar imagem).
- Empresas muito pequenas/nicho podem não ter logo acima do tamanho mínimo — aparecem como **"sem logo"**.
