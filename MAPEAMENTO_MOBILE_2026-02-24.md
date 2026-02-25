# Mapeamento Mobile — 2026-02-24

## Resumo executivo
- **Estado atual:** bom para uso real (layout responsivo, modal com `dvh`, navegação funcional).
- **Nível geral:** **7.5/10** para mobile.
- **Principais riscos:** densidade visual em telas pequenas, tabelas administrativas extensas, peso de bundles JS para rede 4G.

## Escopo avaliado
- Layout global: `src/components/layout/Layout.jsx`, `src/components/layout/Header.jsx`, `src/components/layout/Sidebar.jsx`
- Componentes críticos: `src/components/ui/Modal.jsx`
- Fluxos principais: `src/pages/Conta.jsx`, `src/pages/Loja.jsx`, `src/pages/Plataformas.jsx`
- Área administrativa: `src/pages/Admin.jsx`

## Pontos fortes já existentes
1. **Estrutura mobile-first funcional**
   - Drawer mobile no menu lateral e header com botão de menu.
   - `min-h-[100dvh]` no layout (melhor em mobile moderno do que `100vh`).
2. **Modais com controle de altura e scroll**
   - Uso de `max-h-[calc(100dvh-...)]` + `overflow-y-auto` evita overflow bruto na maior parte dos cenários.
3. **Quebra de grid em telas menores**
   - Uso consistente de `sm:` / `md:` em várias telas principais.
4. **Fluxo PIX no modal**
   - Em `Conta` e `Loja` o usuário consegue concluir com QR + link + copia/cola sem depender de redirecionamento imediato.

## Achados por prioridade

### P0 (alto impacto, ganho rápido)
1. **Header do modal pode ficar grande em celulares pequenos**
   - Arquivo: `src/components/ui/Modal.jsx`
   - Sintoma: título + padding grande (`p-6`) ocupa espaço útil no topo.
   - Risco: rolagem excessiva para conteúdos críticos (PIX/checkout).

2. **Sidebar com logo em tamanho alto no mobile drawer**
   - Arquivo: `src/components/layout/Sidebar.jsx`
   - Sintoma: logo com `h-40` dentro de área `h-20` no topo.
   - Risco: área “apertada”, possível custo visual/performance desnecessário.

3. **Densidade de conteúdo no modal de compra de créditos**
   - Arquivo: `src/pages/Conta.jsx`
   - Sintoma: bloco de checkout + resumo + ações ocupa muita altura em telas pequenas.
   - Risco: fadiga de scroll e queda de conversão no mobile.

### P1 (impacto médio)
4. **Loja com bastante informação por cartão e resumo fixo complexo**
   - Arquivo: `src/pages/Loja.jsx`
   - Sintoma: muitos elementos por card e faixa de resumo fixa em algumas situações.
   - Risco: “poluição visual” e tempo maior de decisão em tela pequena.

5. **Plataformas com grid 2 colunas já no mobile**
   - Arquivo: `src/pages/Plataformas.jsx`
   - Sintoma: em alguns aparelhos estreitos, cards podem ficar visivelmente apertados.
   - Risco: legibilidade e toque em CTA diminuem.

6. **Admin muito dependente de tabelas largas (com overflow-x)**
   - Arquivo: `src/pages/Admin.jsx`
   - Sintoma: várias tabelas com `min-w` e rolagem horizontal.
   - Risco: uso admin em mobile fica funcional, porém cansativo.

### P2 (performance)
7. **Peso total de JS ainda alto para 4G**
   - Evidência de build recente: `vendor-react` + `vendor-supabase` + `Admin` + `Loja` são fatias relevantes.
   - Risco: TTI (tempo até interação) pior em aparelhos modestos.

8. **Imagem de logo remota sem estratégia de fallback local**
   - Arquivo: `src/components/layout/Sidebar.jsx`
   - Risco: dependência externa afeta velocidade e confiabilidade do render inicial.

## Plano de ação recomendado (ordem)

### Sprint curta (1 dia)
1. Reduzir header/padding de modal em mobile (`p-4`, título menor em telas pequenas).
2. Ajustar logo da sidebar mobile para altura menor e consistente com container.
3. Enxugar espaçamentos e blocos do checkout PIX no mobile (`Conta` e `Loja`).
4. Revisar grid de `Plataformas` para 1 coluna em larguras muito estreitas.

### Sprint média (2–3 dias)
5. Criar versão “cards compactos” para tabelas mais importantes do `Admin` em mobile.
6. Revisar hierarquia de informações da `Loja` para reduzir ruído em cards.

### Performance contínua
7. Medir e reduzir chunks iniciais (priorizar rotas públicas e conta/loja).
8. Avaliar fallback local para assets críticos (logo) e revisar imagens acima da dobra.

## Métricas alvo sugeridas
- LCP mobile: **< 2.5s**
- CLS: **< 0.1**
- INP: **< 200ms**
- Taxa de conclusão do fluxo PIX mobile: aumento após ajustes de modal

## Conclusão
A base mobile já é sólida e utilizável, com gargalos concentrados em **densidade de UI** e **peso de carregamento**. Com os ajustes P0 + P1, a experiência pode subir de ~7.5/10 para **8.8+/10** sem refatoração grande.
