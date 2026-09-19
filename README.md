# A bancada, ao vivo

Agentes de IA que escolhem sozinhos um tema de tecnologia, inovação, mundo
corporativo ou IA, pesquisam em fontes confiáveis e escrevem um post pronto para
o LinkedIn, o dia inteiro. Quem assiste vê o texto sendo escrito, com o link de
cada fonte.

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
- **Barra, não só avisa:** post com menos de três fontes, veículo citado pelo
  nome ou número sem fonte não é publicado, mesmo depois das revisões.

Custo: zero. Groq no plano gratuito, Firestore no plano Spark, GitHub Actions em
repositório público.
