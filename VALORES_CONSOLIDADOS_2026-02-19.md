# Valores consolidados (enviados em 19/02/2026)

## Acessos individuais (mensal)

| Produto | Preço mensal |
|---|---:|
| ProEnem | R$ 37,90 |
| ProMedicina | R$ 47,90 |
| Gran Concurso | R$ 25,90 |
| Tec Concursos Adv | R$ 24,90 |
| Focus | R$ 25,90 |
| Direção Concurso | R$ 27,90 |
| Rani Passos | R$ 24,90 |
| Gamma / Aithor | R$ 24,90 |
| ChatGPT Plus | R$ 29,90 |

## Pacotes combinados (mensal)

| Pacote | Preço mensal |
|---|---:|
| 2 acessos | R$ 47,90 |
| 3 acessos | R$ 54,90 |
| 4 acessos | R$ 69,90 |

## Planos econômicos – Gran ilimitado

| Duração | Preço total | Referência mensal |
|---|---:|---:|
| Trimestral | R$ 69,90 | ~R$ 23,30/mês |
| Semestral | R$ 129,90 | R$ 21,65/mês |
| Anual | R$ 189,90 | R$ 15,82/mês |

## Planos econômicos – 2 acessos

| Duração | Preço total | Referência mensal |
|---|---:|---:|
| Trimestral | R$ 134,90 | R$ 44,96/mês |
| Semestral | R$ 229,90 | R$ 38,31/mês |
| Anual | R$ 249,90 | R$ 20,82/mês |

## Planos econômicos – 3 acessos

| Duração | Preço total | Referência mensal |
|---|---:|---:|
| Trimestral | R$ 149,90 | ~R$ 49,97/mês |
| Semestral | R$ 269,90 | R$ 44,98/mês |
| Anual | R$ 389,90 | R$ 32,49/mês |

## Planos econômicos – 4 acessos

| Duração | Preço total | Referência mensal |
|---|---:|---:|
| Trimestral | R$ 154,90 | ~R$ 51,63/mês |
| Semestral | R$ 279,90 | R$ 46,65/mês |
| Anual | R$ 399,90 | R$ 33,32/mês |

## Observações para implementação

- Valores foram convertidos para estrutura técnica no seed SQL em centavos (`price_monthly_cents` no `metadata`).
- Onde houver nome diferente de plataforma no banco, ajustamos por `slug` ou `metadata.platform_id`.
- Próximo passo: você confirma se estes preços são finais para eu travar checkout e cálculo de cobrança.
