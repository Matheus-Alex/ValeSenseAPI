# Relatorio tecnico do backend ValeSense

## Escopo e criterio de verificacao

Este relatorio descreve o codigo e os comandos presentes neste workspace. O diretorio nao possui historico Git disponivel; por isso, quando nao e possivel comprovar se um arquivo ja existia antes das implementacoes, a classificacao de criacao/alteracao fica **a confirmar**. As listas abaixo identificam os arquivos que hoje implementam cada recurso.

O arquivo original `BRIEFING_CODEX_SEGURANCA.md` nao foi localizado no workspace. A tabela de testes cobre os testes encontrados em `tests/` e os casos descritos nas instrucoes recebidas; a correspondencia com casos adicionais do briefing fica **a confirmar**.

## O que foi implementado

### Limites de tentativas, senha e redefinicao

- Os limitadores HTTP usam janela de 15 minutos: 10 tentativas por IP em cadastro, login, solicitacao de redefinicao e redefinicao de senha; login tambem tem limite de 5 por conta; OTP tem limite de 20 por IP e 5 por usuario.
- O limitador IP do login so ignora uma resposta abaixo de 400 quando a rota marcou que emitiu uma sessao; o desafio OTP ainda conta nesse limite. O limitador por conta usa `skipSuccessfulRequests` padrao do middleware, portanto uma resposta de desafio HTTP 200 tambem fica fora do contador por conta.
- A senha nova precisa ter pelo menos 8 caracteres e no maximo 72 bytes em UTF-8. O limite e validado por `Buffer.byteLength`, para evitar o truncamento de entrada pelo bcrypt. A regra e usada no cadastro e na redefinicao de senha.
- O pedido de redefinicao mantem resposta generica. O link de redefinicao so e escrito no log quando o ambiente e `development` e a opcao `DEV_LOG_RESET_LINK` esta habilitada. Esse log contem o link portador do token e o e-mail; nao habilite essa opcao em producao.

Arquivos relacionados:

- Limites: [rate-limit.ts](../src/middleware/rate-limit.ts), [auth.routes.ts](../src/modules/auth/auth.routes.ts), [express.d.ts](../src/types/express.d.ts) e [otp.test.ts](../tests/otp.test.ts).
- Bytes de senha: [password.ts](../src/lib/password.ts), usado em [auth.routes.ts](../src/modules/auth/auth.routes.ts).
- Redefinicao/log do link: [password-reset.service.ts](../src/modules/auth/password-reset.service.ts), [auth.routes.ts](../src/modules/auth/auth.routes.ts), [env.ts](../src/config/env.ts) e [.env.example](../.env.example). A origem historica exata de `password.ts` e `password-reset.service.ts` fica **a confirmar** sem historico Git.

### IDOR e propriedade

- A verificacao central recebe a identidade e o perfil da sessao. Para sensor, encontra o proprietario por `Sensor -> Talhao -> Propriedade -> Usuario`; para talhao, por `Talhao -> Propriedade -> Usuario`.
- `ADMIN` pode acessar recursos existentes de qualquer usuario, e o acesso global e registrado. Os demais perfis so passam pela verificacao se o recurso pertencer ao usuario autenticado.
- Recurso inexistente e recurso de outro usuario resultam no mesmo 404. ID que nao seja UUID v4 valido e rejeitado como entrada invalida (400).
- A checagem direta e usada em `POST /api/sensors` (talhao recebido no corpo), `PATCH /api/sensors/:id/status`, `POST /api/sensors/:id/comandos` e `GET /api/weather-data?sensorId=...`. Listas de sensores, leituras e previsoes tambem aplicam filtros de propriedade.
- A rota de comando altera o status persistido (`ATIVO` ou `INATIVO`); nao envia instrucao a ESP32, ThingSpeak ou outro dispositivo.

Arquivos relacionados:

- Criados para o controle central e logs: [ownership.ts](../src/lib/ownership.ts), [ownership-prisma.ts](../src/lib/ownership-prisma.ts) e [security-log.ts](../src/lib/security-log.ts).
- Alterados/relacionados: [ids.ts](../src/lib/ids.ts), [error-handler.ts](../src/middlewares/error-handler.ts), [sensors.routes.ts](../src/modules/sensors/sensors.routes.ts), [weather-data.routes.ts](../src/modules/weather-data/weather-data.routes.ts), [forecasts.routes.ts](../src/modules/forecasts/forecasts.routes.ts) e [users.routes.ts](../src/modules/users/users.routes.ts).
- Teste e materiais: [ownership.test.ts](../tests/ownership.test.ts), [modelo-ameacas.md](modelo-ameacas.md), [inventario-rotas.md](inventario-rotas.md), [idor-http.mjs](testes/idor-http.mjs), [idor-antes.mjs](testes/idor-antes.mjs), [idor-depois.mjs](testes/idor-depois.mjs), [dados-exemplo.json](testes/dados-exemplo.json) e [dados-exemplo.mjs](testes/dados-exemplo.mjs).

### OTP e login em duas etapas

1. O usuario envia e-mail e senha para `POST /api/auth/login`. Se o OTP estiver ativo, o backend nao entrega sessao: devolve `otpRequired` e um JWT curto com `purpose: "otp"`. A expiracao e configuravel.
2. O cliente envia o desafio e exatamente um fator — codigo TOTP ou codigo de recuperacao — para `POST /api/auth/login/otp`.
3. O backend valida o desafio, localiza o usuario do `sub` do token e verifica o fator. Em sucesso, emite o JWT normal de sessao. Falhas OTP respondem com mensagem generica 401; o motivo especifico fica no log de seguranca.
4. `authenticate` rejeita explicitamente um token cujo `purpose` seja `otp`, portanto o desafio nao autoriza rotas de sessao.
5. O segredo TOTP e cifrado com AES-256-GCM. O setup retorna URI `otpauth://` e QR Code; a ativacao e a regeneracao retornam codigos de recuperacao em texto apenas naquela resposta. No armazenamento, os codigos ficam como hashes.
6. O passo TOTP mais recente e atualizado condicionalmente para impedir reutilizacao concorrente. O consumo de cada codigo de recuperacao tambem e condicional e de uso unico.
7. `OTP_STORE=memory` e temporario e e recusado em producao. `OTP_STORE=prisma` usa o repositorio Prisma. A chave de cifra e validada durante a inicializacao.

**Politica por perfil:** o verificador central trata `ADMIN` como acesso global registrado e aplica propriedade aos demais perfis. As rotas tambem podem impor perfis permitidos: por exemplo, criacao e alteracao de status de sensor permitem `ADMIN` e `PRODUTOR_EXPORTADOR`; alertas de previsao tambem restringem `ANALISTA`. A rota de comando nao tem um filtro de role proprio: qualquer usuario autenticado que seja dono passa pela verificacao central. A politica definitiva de `ANALISTA` permanece **a confirmar**.

### Rotas novas ou com comportamento de OTP

| Metodo e rota | Autenticacao/perfil no backend | Funcao |
|---|---|---|
| `POST /api/auth/login` | Publica | Rota existente com novo resultado: sessao normal ou desafio OTP, conforme a conta. |
| `POST /api/auth/login/otp` | Desafio OTP valido; limite por IP e usuario | Valida TOTP ou codigo de recuperacao e emite sessao. |
| `POST /api/auth/otp/setup` | Sessao autenticada; limite por IP e usuario | Prepara segredo cifrado, URI e QR. |
| `POST /api/auth/otp/activate` | Sessao autenticada; limite por IP e usuario | Ativa o segundo fator e devolve codigos de recuperacao. |
| `POST /api/auth/otp/disable` | Sessao autenticada; senha e TOTP; limite por IP e usuario | Desativa OTP e remove codigos de recuperacao. |
| `POST /api/auth/otp/recovery-codes/regenerate` | Sessao autenticada e TOTP; limite por IP e usuario | Consome um passo TOTP e substitui os codigos de recuperacao. |
| `POST /api/sensors/:id/comandos` | Qualquer sessao autenticada; exige propriedade ou role `ADMIN` | Aceita `LIGAR`/`DESLIGAR` e atualiza apenas o status no banco. |

Arquivos relacionados ao OTP:

- Implementacao: [otp.repository.ts](../src/modules/auth/otp.repository.ts), [memory-otp.repository.ts](../src/modules/auth/memory-otp.repository.ts), [prisma-otp.repository.ts](../src/modules/auth/prisma-otp.repository.ts), [otp.repository-provider.ts](../src/modules/auth/otp.repository-provider.ts), [otp-crypto.ts](../src/modules/auth/otp-crypto.ts), [otp.service.ts](../src/modules/auth/otp.service.ts), [otp-login.ts](../src/modules/auth/otp-login.ts), [otp.routes.ts](../src/modules/auth/otp.routes.ts), [token.ts](../src/modules/auth/token.ts) e [authenticate.ts](../src/middleware/authenticate.ts).
- Integracao e testes: [auth.routes.ts](../src/modules/auth/auth.routes.ts), [rate-limit.ts](../src/middleware/rate-limit.ts), [auth.types.ts](../src/modules/auth/auth.types.ts), [schema.prisma](../prisma/schema.prisma), [otp.test.ts](../tests/otp.test.ts), [otp-antes.mjs](testes/otp-antes.mjs) e [otp-depois.mjs](testes/otp-depois.mjs).
- Documentacao: [README.md](README.md) e [proposta-schema-2fa.md](proposta-schema-2fa.md).

### Migracao para PostgreSQL

- O provider Prisma atual e PostgreSQL. Os IDs primarios usam `String @id @default(uuid())`; os relacionamentos mantem tipos string compativeis.
- `src/lib/ids.ts` centraliza a validacao de UUID v4. O endpoint `/health` usa `$queryRaw` com `SELECT 1`.
- `db:push` nao esta no `package.json`. Estao disponiveis `db:migrate:dev`, `db:migrate:deploy` e `db:migrate:status`.
- A migration inicial, incluindo as colunas OTP e `CodigoRecuperacao`, esta em [migration.sql](../prisma/migrations/20261121000000_init_postgresql/migration.sql). Foi gerada a partir do schema, mas nao aplicada. A migracao de dados existentes de outro banco nao esta incluida.

Arquivos relacionados:

- Migration criada: [migration.sql](../prisma/migrations/20261121000000_init_postgresql/migration.sql).
- Schema/configuracao alterados: [schema.prisma](../prisma/schema.prisma), [migration_lock.toml](../prisma/migrations/migration_lock.toml), [app.ts](../src/app.ts), [ids.ts](../src/lib/ids.ts), [package.json](../package.json), [.env.example](../.env.example), [ci.yml](../.github/workflows/ci.yml) e [.gitignore](../.gitignore).
- Fixtures e documentacao: [otp.test.ts](../tests/otp.test.ts), [ownership.test.ts](../tests/ownership.test.ts), [dados-exemplo.json](testes/dados-exemplo.json), [COMO_RODAR.md](testes/COMO_RODAR.md), [inventario-rotas.md](inventario-rotas.md), [README.md](README.md) e [proposta-schema-2fa.md](proposta-schema-2fa.md).

O workspace nao tem metadados Git para verificar a situacao historica de cada arquivo. A lista acima confirma o conteudo atual; para arquivos nao identificados explicitamente como criados ou como migration nova, a classificacao individual fica **a confirmar**.

## Variaveis de ambiente

Os nomes abaixo foram conferidos em [env.ts](../src/config/env.ts), [.env.example](../.env.example) e nos scripts. Este relatorio nao inclui valores.

### Aplicacao

| Nome | Finalidade |
|---|---|
| `PORT` | Porta HTTP da API. |
| `NODE_ENV` | Ambiente (`development`, `test` ou `production`); controla, entre outros, o uso do armazenamento OTP em memoria. |
| `CORS_ORIGIN` | Origens autorizadas por CORS. |
| `TRUST_PROXY` | Numero de proxies confiaveis para interpretar dados da requisicao, incluindo IP. |
| `MISSION_CODE` | Codigo opcional usado no log de seguranca; formato validado no ambiente. Se ausente, o log usa `SEM-CODIGO` e avisa na inicializacao. |
| `DATABASE_URL` | Conexao do Prisma ao PostgreSQL. |
| `JWT_SECRET` | Assinatura dos JWTs de sessao e desafio. |
| `JWT_EXPIRES_IN` | Validade do JWT de sessao. |
| `OTP_STORE` | Seleciona o repositorio OTP em memoria ou Prisma. |
| `OTP_ISSUER` | Nome do emissor no URI TOTP. |
| `OTP_WINDOW` | Tolerancia de passos TOTP. |
| `OTP_ENCRYPTION_KEY` | Chave de ambiente para cifrar o segredo TOTP; obrigatoria e validada como Base64 de 32 bytes. |
| `OTP_CHALLENGE_EXPIRES_SECONDS` | Validade do desafio OTP. |
| `OTP_RECOVERY_CODES_COUNT` | Quantidade de codigos de recuperacao emitidos. |
| `PASSWORD_RESET_EXPIRES_MINUTES` | Validade do token de redefinicao de senha. |
| `DEV_LOG_RESET_LINK` | Habilita o log do link de redefinicao somente em desenvolvimento. |
| `ADMIN_NAME` | Nome opcional para a criacao inicial do administrador. |
| `ADMIN_EMAIL` | E-mail opcional para a criacao inicial do administrador. |
| `ADMIN_PASSWORD` | Senha fornecida pelo ambiente para a criacao inicial do administrador. |

### Scripts HTTP de teste

| Nome | Finalidade |
|---|---|
| `BASE_URL` | Endereco da API de teste. |
| `TOKEN_PRODUTOR_A` | Sessao do produtor usada pelos scripts IDOR. |
| `SENSOR_A_ID` | Sensor pertencente ao produtor A no ambiente descartavel. |
| `SENSOR_B_ID` | Sensor pertencente ao produtor B no ambiente descartavel. |
| `TALHAO_B_ID` | Talhao pertencente ao produtor B no ambiente descartavel. |
| `OTP_TEST_EMAIL` | Conta descartavel usada nos scripts OTP. |
| `OTP_TEST_PASSWORD` | Senha da conta descartavel, fornecida fora do repositorio. |
| `OTP_TEST_WINDOW` | Janela usada pelo script HTTP OTP para gerar um codigo expirado. |

## Como executar do zero

Os comandos abaixo sao para execucao pela equipe em um ambiente aprovado. **A migration aplica alteracoes ao banco; nenhum comando de banco foi executado para produzir este relatorio.** Preencha `.env` localmente com valores do ambiente, sem inclui-los no repositorio.

Na raiz do projeto, em PowerShell:

```powershell
npm ci
Copy-Item .env.example .env
npm run db:validate
npm run db:generate
```

Depois que o responsavel pelo banco revisar a migration e preparar o PostgreSQL:

```powershell
npm run db:migrate:deploy
npm run dev
```

`npm run db:migrate:dev` e a alternativa de desenvolvimento que pode criar migrations; `npm run db:migrate:status` consulta o estado das migrations. Nenhum deles foi executado aqui. A migration inicial nao cria os registros ficticios do teste.

O arquivo [dados-exemplo.mjs](testes/dados-exemplo.mjs) apenas imprime o conteudo de [dados-exemplo.json](testes/dados-exemplo.json):

```powershell
node seguranca/testes/dados-exemplo.mjs
```

Ele nao semeia o banco. Para os scripts HTTP, a equipe deve preparar uma base descartavel com os dois produtores, propriedade, talhao e sensor de cada um, e administrador; os IDs e a sessao devem corresponder a essa base.

Validacoes automatizadas:

```powershell
npm run check
npm run build
npm test
```

Scripts HTTP, depois de definir no ambiente os nomes listados acima:

```powershell
node seguranca/testes/idor-antes.mjs
node seguranca/testes/idor-depois.mjs
node seguranca/testes/otp-antes.mjs
node seguranca/testes/otp-depois.mjs
```

Os scripts `antes` devem apontar para uma versao-base anterior as protecoes; nao devem ser executados contra a versao atual esperando os resultados antigos. `otp-depois` ativa OTP na conta e nao a desativa, por isso use conta descartavel. Os scripts imprimem status HTTP, mas nao produzem evidencias de entrega automaticamente. Nao execute contra contas ou dados reais.

## Casos de teste e cobertura encontrada

O comando `npm test` executa `tests/ownership.test.ts` e `tests/otp.test.ts`. A tabela mapeia os testes automatizados encontrados; scripts HTTP manuais nao contam como testes executados.

| Caso | Teste localizado | Cobertura/limite |
|---|---|---|
| Dono acessa sensor e talhao proprios | `permite ao dono acessar sensor e talhao proprios` em [ownership.test.ts](../tests/ownership.test.ts) | Verifica o checker com repositorio falso em memoria. |
| ID de terceiro e ID inexistente tem o mesmo 404 | `retorna o mesmo 404 para recurso de terceiro e recurso inexistente` em [ownership.test.ts](../tests/ownership.test.ts) | Nao exercita uma consulta real ao PostgreSQL. |
| Acesso global do administrador e log | `permite acesso administrativo e registra o acesso` em [ownership.test.ts](../tests/ownership.test.ts) | Verifica o logger falso do checker. |
| UUID aceito e IDs malformados rejeitados | `aceita UUID e rejeita IDs antigos ou malformados` em [ownership.test.ts](../tests/ownership.test.ts) | Testa o schema central, nao uma resposta HTTP 400. |
| Login com OTP ativo inicia desafio e login sem OTP emite sessao | `senha validada com 2FA ativo inicia desafio e login sem 2FA segue com sessao` em [otp.test.ts](../tests/otp.test.ts) | Exercita `beginOtpLogin`; nao conecta o fluxo a um banco. |
| Segredo cifrado, URI, QR e codigos de recuperacao | `setup cifra o segredo, devolve URI e QR e ativacao devolve recuperacoes uma vez` em [otp.test.ts](../tests/otp.test.ts) | Testa servico e repositorio em memoria. |
| Setup, ativacao, regeneracao e desativacao autenticados | `expõe setup, ativacao, regeneracao e desativacao autenticados` em [otp.test.ts](../tests/otp.test.ts) | Usa harness HTTP e repositório em memoria. |
| Codigo de recuperacao valido uma vez no login | `aceita codigo de recuperacao uma vez no endpoint de login` em [otp.test.ts](../tests/otp.test.ts) | Coberto no endpoint do harness. |
| Codigo TOTP incorreto, vencido ou reutilizado | `aceita codigo valido, rejeita codigo errado, vencido e reutilizado` em [otp.test.ts](../tests/otp.test.ts) | Testa validacao do servico em memoria. |
| Hashes de recuperacao, uso unico e substituicao | `consome codigo de recuperacao uma unica vez e substitui os anteriores` em [otp.test.ts](../tests/otp.test.ts) | Verifica que o codigo antigo deixa de funcionar. |
| Duas requisicoes simultaneas com o mesmo passo | `serializa duas requisicoes concorrentes para um mesmo passo TOTP` em [otp.test.ts](../tests/otp.test.ts) | Concorrencia no repositorio em memoria; nao comprova concorrencia no PostgreSQL. |
| Janela obtida da variavel `OTP_WINDOW` | `usa OTP_WINDOW configuravel para aceitar um passo anterior` em [otp.test.ts](../tests/otp.test.ts) | Compara janela zero e uma janela configurada. |
| Desafio de outro usuario e desafio expirado | `rejeita codigo do usuario B com desafio do usuario A e desafios expirados` em [otp.test.ts](../tests/otp.test.ts) | Coberto no harness OTP. |
| Resposta OTP generica e evento de seguranca | `completa login OTP com 200, registra sucesso/falha e usa resposta generica` em [otp.test.ts](../tests/otp.test.ts) | Verifica status, resposta e eventos do harness. |
| Desafio nao aceito como token de sessao | `rejeita challengeToken como sessao protegida` em [otp.test.ts](../tests/otp.test.ts) | Verifica que o middleware responde 401. |
| Tentativas limitadas por usuario e IP no OTP | `aplica limite de tentativas por usuario e por IP` em [otp.test.ts](../tests/otp.test.ts) | Usa limitadores de teste no endpoint do harness. |
| Separacao de limitadores por rota e login bem-sucedido fora do limite IP | `separa limites por rota e nao conta sessoes de login bem-sucedidas por IP` em [otp.test.ts](../tests/otp.test.ts) | Verifica login/cadastro; nao testa individualmente os contadores de esqueci/reset senha. |
| Rejeicao do armazenamento OTP em memoria na producao | `recusa repositorio em memoria em producao` em [otp.test.ts](../tests/otp.test.ts) | Verifica a fabrica do repositorio. |
| Falta da chave de cifra impede inicializacao | `falha na inicializacao se OTP_ENCRYPTION_KEY estiver vazia` em [otp.test.ts](../tests/otp.test.ts) | Verifica erro de configuracao em processo filho. |
| Limite de 72 bytes da senha | Nenhum teste automatizado correspondente localizado em `tests/`. | A regra existe em [password.ts](../src/lib/password.ts); cobertura automatizada: **a confirmar**. |
| Log condicional do link de redefinicao | Nenhum teste automatizado correspondente localizado em `tests/`. | A condicao existe em [auth.routes.ts](../src/modules/auth/auth.routes.ts); cobertura automatizada: **a confirmar**. |
| Rotas IDOR HTTP com banco e migration PostgreSQL | Scripts em [idor-depois.mjs](testes/idor-depois.mjs); sem teste automatizado de banco encontrado. | Nao executados contra banco; resultado de ambiente real: **a confirmar**. |

## O que foi validado e o que nao foi

Validacoes locais registradas para o codigo atual:

- `npm run check`, `npm run build` e `npm test` passaram; a suite tem 19 testes.
- `npm run db:validate` validou a sintaxe do schema Prisma e `npm run db:generate` gerou o cliente.
- A migration inicial foi gerada a partir do schema e comparada com o SQL esperado pelo Prisma.
- O workflow [ci.yml](../.github/workflows/ci.yml) roda instalacao, check, build e testes; ele nao sobe um PostgreSQL.

**Nao validado contra banco:** nenhuma consulta real ao PostgreSQL, `db:migrate:dev`, `db:migrate:deploy`, `db:migrate:status`, escrita, seed ou teste do repositorio OTP Prisma. Tambem nao foi feita migracao de dados de uma base anterior. Portanto, migracao aplicada, integridade dos dados e comportamento concorrente em PostgreSQL permanecem **a confirmar**.

Os scripts `antes/depois` nao foram executados como evidencias HTTP neste relatorio. O briefing original nao esta presente para confirmar se ha casos adicionais fora da tabela.

## Pendencias por responsavel

| Responsavel | Pendencias |
|---|---|
| Banco/equipe de dados | Revisar [schema.prisma](../prisma/schema.prisma) e [migration.sql](../prisma/migrations/20261121000000_init_postgresql/migration.sql); preparar PostgreSQL, configurar `DATABASE_URL`, aplicar a migration somente com aprovacao; definir plano de migracao dos dados existentes e testar repositorio Prisma. |
| Frontend | Integrar o desafio e a verificacao OTP; apresentar QR, guardar/avisar sobre codigos de recuperacao de exibicao unica; implementar desativacao e regeneracao; validar as respostas e o fluxo visual. A existencia/estado do frontend nao foi verificada neste workspace: **a confirmar**. |
| Nuvem/infra | Provisionar PostgreSQL e configurar variaveis de ambiente no gerenciador de segredos; usar armazenamento `prisma` em producao; configurar CORS, proxy, observabilidade e health check. Deploy e configuracao de nuvem: **a confirmar**. |
| Evidencias/testes | Preparar ambiente descartavel e registros sinteticos; executar scripts HTTP `antes/depois`; guardar evidencias reais e anonimizadas. Nenhuma evidencia foi criada por este relatorio. |
| Documentacao/equipe | Revisar o modelo de ameacas e a proposta de schema OTP; confirmar o briefing e o titulo oficial da atividade. O titulo permanece **a confirmar**. |
| Release/tag | Criar e validar a tag de entrega apos revisao e aprovacao. O workspace nao possui metadados Git; existencia de tag: **a confirmar**. |

## Limitacoes e decisoes pendentes

- **Codigo de missao:** nao foi inventado nem configurado neste relatorio. `MISSION_CODE` permanece opcional; sem ele, o log usa `SEM-CODIGO` e emite aviso na inicializacao.
- **Perfil `ANALISTA`:** a regra central atual e acesso somente aos proprios recursos, salvo `ADMIN`, mas as permissoes explicitas das rotas variam. A rota de comando permite operacao sobre sensor proprio para qualquer perfil autenticado. A politica de negocio final precisa ser aprovada e, se necessario, aplicada de forma uniforme.
- **Titulo da atividade:** **a confirmar** pela equipe/docente.
- **Comando de dispositivo:** hoje altera apenas o status no banco; a integracao fisica ou remota nao esta implementada.
- **OTP em memoria:** perde estado ao reiniciar e nao compartilha dados entre instancias; nao e adequado para producao.
- **Link de redefinicao:** o log de desenvolvimento pode conter um link com token; deve permanecer desabilitado fora de desenvolvimento e nao substitui um provedor de e-mail.
- **Migration e dados:** a migration inicial cria o schema PostgreSQL, mas nao converte dados de uma base anterior nem foi aplicada.
