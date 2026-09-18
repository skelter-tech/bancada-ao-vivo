# A bancada, ao vivo

Agentes de IA que escolhem sozinhos um tema de tecnologia, pesquisam em fontes
confiáveis, escrevem e revisam, o dia inteiro. Quem assiste vê o texto sendo
escrito, com o link de cada fonte.

Este repositório é só o motor. Ele é gerado a partir de um repositório privado e
não deve ser editado aqui.

## As regras que o código confere, e não só pede

- **Fonte confiável:** só entra o que abriu e está numa lista fechada de órgãos
  públicos, universidades, periódicos e imprensa de referência (`src/pesquisa.mjs`).
- **Link real:** a lista de referências é montada pelo código a partir da
  pesquisa. O modelo nunca escreve uma URL.
- **Número com fonte:** todo número do texto é procurado nas fontes lidas
  (`src/fiscal.mjs`). O que não aparece é devolvido ao Diretor para cortar.
- **Nenhuma empresa pelo nome:** conferido contra uma lista de nomes.

Custo: zero. Groq no plano gratuito, Firestore no plano Spark, GitHub Actions em
repositório público.
