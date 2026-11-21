# Seguranca ValeSense

## Identificacao

- Projeto: ValeSense — backend do dashboard de monitoramento climatico.
- Controles desta entrega: protecao IDOR e autenticacao TOTP em duas etapas.
- Codigo de missao: preencher depois da confirmacao do professor; nao inventar.

## Como testar

Os testes automatizados rodam com repositórios OTP em memoria e nao conectam ao banco:

```text
npm run check
npm run build
npm test
```

Os testes HTTP com dados sinteticos e variaveis de ambiente estao descritos em `testes/COMO_RODAR.md`. Os scripts antes/depois nao produzem evidencias automaticamente: as execucoes e evidencias precisam ser geradas pela equipe.

## OTP e armazenamento

`OTP_STORE=prisma` usa o banco e os campos/modelo OTP propostos no schema. Antes de usar essa opcao, o colega responsavel deve revisar e aplicar a alteracao de schema no ambiente correto. Nenhum comando de banco foi executado nesta entrega.

`OTP_STORE=memory` serve somente para desenvolvimento e testes. A API recusa esse modo em `NODE_ENV=production` e avisa quando ele e inicializado. O estado, segredos cifrados e codigos de recuperacao ficam apenas na memoria do processo: reiniciar a API os perde, e multiplas instancias nao compartilham estado. Portanto, `memory` nao fornece persistencia nem e adequado para producao.

`OTP_ENCRYPTION_KEY` e obrigatoria em todos os ambientes e deve ser uma chave Base64 que represente 32 bytes. Guarde-a no gerenciador de segredos do ambiente; nao a salve no repositorio. O `.env.example` contem a variavel sem valor.

O segredo TOTP fica cifrado com AES-256-GCM. O link `otpauth://` e o QR Code sao devolvidos apenas no setup pendente; os codigos de recuperacao em texto sao devolvidos uma unica vez na ativacao ou regeneracao. Os logs nunca incluem senha, token, codigo OTP, codigo de recuperacao ou segredo.

## Resultados e limitacoes

- O passo TOTP e aceito uma unica vez; a atualizacao condicional no repositório evita duas validacoes concorrentes do mesmo passo.
- Codigos de recuperacao sao armazenados como hashes e consumidos atomicamente.
- Falhas OTP respondem com erro generico; o motivo interno vai para o log de seguranca.
- O schema declara PostgreSQL e usa UUIDs; `/health` executa `SELECT 1`. A migration inicial foi gerada em `prisma/migrations/20261121000000_init_postgresql/migration.sql`, mas nao foi aplicada e nenhuma conexao ao banco foi validada nesta entrega.
- Apos revisao do responsavel, use `npm run db:migrate:dev` em desenvolvimento e `npm run db:migrate:deploy` em implantacao. Esses comandos nao foram executados.
- Ficam pendentes a revisao e aplicacao do schema pelo responsavel, o codigo de missao e a validacao das telas do frontend.
