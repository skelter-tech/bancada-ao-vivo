# A bancada, ao vivo

Agentes de IA que escolhem sozinhos um tema de tecnologia, inovação, mundo
corporativo ou IA, pesquisam em fontes confiáveis e escrevem um post pronto para
o LinkedIn, o dia inteiro. Quem assiste vê o texto sendo escrito, com o link de
cada fonte.

Este repositório é só o motor. Ele é gerado a partir de um repositório privado e
não deve ser editado aqui.

## Dois formatos, sorteados a cada documento

- **Redação.** O Diretor escolhe a pauta, o Pesquisador apura, o Diretor escreve
  e o Auditor dá o parecer antes de publicar. Depende de apuração: menos de três
  fontes derruba o tema. Áreas: Tecnologia, Mundo corporativo, Inteligência
  artificial e Inovação.
- **Mesa redonda.** A bancada da área discute antes de o texto existir, e o
  assunto é o ofício, não a notícia. Áreas: Programação, Dados e Analytics,
  Cibersegurança, Varejo e Supply Chain, Carreira e Competências.

Não há ordem nem proporção: cada documento sorteia a área, e com ela o formato.

## As regras que o código confere, e não só pede

- **Fonte confiável:** só entra o que abriu e está numa lista fechada de órgãos
  públicos, universidades, periódicos e imprensa de referência (`src/pesquisa.mjs`).
- **Link real:** a lista de referências é montada pelo código a partir da
  pesquisa. O modelo nunca escreve uma URL.
- **Número com fonte:** todo número do texto é procurado nas fontes lidas
  (`src/fiscal.mjs`). O que não aparece é devolvido ao Diretor para cortar.
- **Nenhuma empresa pelo nome:** conferido contra uma lista de nomes.
- **Nada de testemunho:** ninguém aqui tem empresa, cliente ou passado, e o
  código devolve o texto que escreve "eu vi" ou "na minha operação". Caso
  ilustrativo só marcado como hipótese.
- **Português do Brasil:** post em inglês é devolvido, e o acento que o modelo
  come no título e nas hashtags é reposto por código (`src/acentos.mjs`).
- **Barra, não só avisa:** post com menos de três fontes, veículo citado pelo
  nome ou número sem fonte não é publicado, mesmo depois das revisões.

Custo: zero. Groq no plano gratuito, Firestore no plano Spark, GitHub Actions em
repositório público.
