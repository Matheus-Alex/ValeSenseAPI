# Inventario de rotas

Snapshot antes do controle IDOR: 2026-11-20

As tabelas acima registram o estado anterior a implementacao. O resultado atual da Parte 1 esta resumido no adendo ao final.

## Cadeia real de propriedade

`Usuario -> Propriedade -> Talhao -> Sensor -> LeituraClimatica`

Os campos reais no `prisma/schema.prisma` sao:

- `Usuario.id`
- `Propriedade.usuarioId` referencia `Usuario.id`
- `Talhao.propriedadeId` referencia `Propriedade.id`
- `Sensor.talhaoId` referencia `Talhao.id`
- `LeituraClimatica.sensorId` referencia `Sensor.id`
- `Previsao.talhaoId` referencia `Talhao.id`
- `Alerta.previsaoId` referencia `Previsao.id`

O dono de um sensor pode ser encontrado pela cadeia:

```text
Sensor.talhaoId
-> Talhao.propriedadeId
-> Propriedade.usuarioId
-> Usuario.id
```

Tambem existe a cadeia de leitura: `LeituraClimatica.sensorId -> Sensor -> Talhao -> Propriedade -> Usuario`.

As previsoes pertencem ao usuario atraves de `Previsao.talhaoId -> Talhao -> Propriedade -> Usuario`.
Os alertas pertencem ao usuario atraves de `Alerta.previsaoId -> Previsao -> Talhao -> Propriedade -> Usuario`.

## Inventario das rotas

| Metodo | Rota | Onde vem o ID | Perfis permitidos | Checagem de dono atual | Situacao |
|---|---|---|---|---|---|
| GET | `/api/sensors/plots` | Nenhum ID de recurso na requisicao | Codigo permite `ADMIN` e `PRODUTOR_EXPORTADOR` | Para produtor, filtra talhoes por `propriedade.usuarioId = request.user.id`; ADMIN recebe todos | Bloqueio por consulta; nao recebe ID diretamente |
| GET | `/api/sensors` | Nenhum ID na requisicao | Qualquer usuario autenticado | Para produtor, filtra sensores por `talhao.propriedade.usuarioId = request.user.id`; outros perfis recebem todos | Bloqueio por consulta; ANALISTA recebe todos porque nao ha filtro |
| POST | `/api/sensors` | `talhaoId` no corpo | Somente `ADMIN` | Apenas valida formato UUID; nao verifica a propriedade do talhao nem um PRODUTOR | Sem controle de dono; o ADMIN pode criar um sensor apontando para qualquer talhao |
| PATCH | `/api/sensors/:id/status` | `id` do sensor na URL | Somente `ADMIN` | Apenas valida formato e atualiza por `id`; nao verifica propriedade | Sem controle de dono por ID; o ADMIN tem acesso global atual |
| GET | `/api/weather-data?sensorId=...` | `sensorId` na query | Qualquer usuario autenticado | Valida o formato; para produtor combina `sensorId` com filtro pela propriedade do usuario | Condicao relacional protege produtores; se nao for PRODUTOR, nao ha filtro |
| GET | `/api/forecasts/alerts` | Nenhum ID direto; referencia dados ligados a `previsaoId` e `talhaoId` | Codigo permite `ADMIN` e `PRODUTOR_EXPORTADOR` | Para produtor filtra alertas por `previsao.talhao.propriedade.usuarioId = request.user.id` | Bloqueio por consulta; recebe dados somente das propriedades do produtor |
| GET | `/api/forecasts` | Nenhum ID direto; referencia previsoes ligadas a `talhaoId` | Qualquer usuario autenticado | Para produtor filtra por `talhao.propriedade.usuarioId = request.user.id`; outros perfis recebem todos | Bloqueio por consulta; ANALISTA recebe todos |
| GET | `/api/market-data` | Nenhum ID de sensor, talhao, propriedade, leitura, previsao ou alerta | Qualquer usuario autenticado | Nao existe verificacao de dono; os dados sao de mercado, nao pertencem a um usuario | Dados globais, fora da cadeia de propriedade |
| GET | `/api/users/me/notifications` | Nenhum ID na requisicao | Qualquer usuario autenticado | Filtra por `usuarioId = request.user.id` | Confere dono diretamente |
| GET | `/api/users/me/configuration` | Nenhum ID na requisicao | Qualquer usuario autenticado | Filtra por `usuarioId = request.user.id` | Confere dono diretamente |
| PUT | `/api/users/me/configuration` | Nenhum ID na requisicao | Qualquer usuario autenticado | Todas as configuracoes usam `usuarioId = request.user.id` | Confere dono diretamente |
| GET | `/api/users/:id` | Esta rota nao existe | Nao se aplica | Nao se aplica | Nao foi encontrada |
| PATCH | `/api/users/:id/status` | `id` do usuario na URL | Somente `ADMIN` | Busca e altera o usuario informado; a verificacao atual impede alterar o proprio ADMIN | Controle administrativo, nao pertence a propriedade de dispositivo |
| PATCH | `/api/users/:id/role` | `id` do usuario na URL | Somente `ADMIN` | Busca e altera o usuario informado; a verificacao atual impede alterar o proprio ADMIN | Controle administrativo, nao pertence a propriedade de dispositivo |

Nao foram encontradas rotas que recebam diretamente `propriedadeId`, `leituraId`, `previsaoId` ou `alertaId`.

## Rotas que conferem o dono

- `/api/sensors/plots`: filtra talhoes pela propriedade do produtor.
- `/api/sensors`: filtra sensores pela propriedade do produtor.
- `/api/weather-data?sensorId=...`: combina o sensor solicitado com o filtro pela propriedade do produtor.
- `/api/forecasts/alerts`: filtra alertas pela propriedade do produtor.
- `/api/forecasts`: filtra previsoes pela propriedade do produtor.
- `/api/users/me/notifications`: filtra notificacoes pelo usuario da sessao.
- `/api/users/me/configuration`: filtra ou atualiza configuracoes pelo usuario da sessao.

Observacao: essas verificacoes sao filtros em consultas. A auditoria ainda precisa confirmar se a resposta para ID de outro usuario sera 404 uniforme em todas as rotas futuras que recebem ID diretamente.

## Rotas sem verificacao ou com verificacao incompleta

- `POST /api/sensors`: recebe `talhaoId` no corpo, mas apenas valida o formato. Um usuario autorizado a criar o sensor pode apontar para o talhao de outro usuario.
- `PATCH /api/sensors/:id/status`: recebe o sensor pela URL, mas nao resolve ou compara o dono. Hoje a rota e exclusivamente administrativa.
- Os filtros atuais nao impedem `ANALISTA` de receber todas as listas em `/api/sensors`, `/api/forecasts` e `/api/weather-data`, porque o filtro existe somente para `PRODUTOR_EXPORTADOR`.
- Nao existe verificacao de dono por uma funcao unica em `src/lib/`.

## Rota de comando

Nao existe nenhuma rota atual que envie comando a um dispositivo. A rota existente `PATCH /api/sensors/:id/status` altera o status no banco, mas nao representa um comando externo nem envia uma instrucao ao ESP32/ThingSpeak.

Ponto mais simples para criar a rota: `POST /api/sensors/:id/comandos`, no mesmo `src/modules/sensors/sensors.routes.ts`, com a validacao Zod de um conjunto fechado como `LIGAR` e `DESLIGAR`.

A rota futura deve:

1. validar o `id` como UUID;
2. autenticar o usuario;
3. verificar a propriedade pela cadeia `Sensor -> Talhao -> Propriedade -> Usuario`;
4. validar o comando com Zod;
5. aplicar uma politica por perfil;
6. registrar bloqueio no log de seguranca no futuro.

## Sobras e referencias

Arquivos no estado atual que aparecem como sobras ou nao fazem parte do codigo ligado por `src/app.ts`:

| Caminho | Existe no projeto atual | Importado por `src` |
|---|---:|---:|
| `src/modules/weather-data/weather-source.ts` | Nao | Nao |
| `src/modules/weather-data/weather-data.mock.ts` | Nao | Nao |
| `src/modules/market-data/market-data.mock.ts` | Nao | Nao |
| `src/modules/alerts/` | Nao | Nao |
| `src/modules/dashboard/` | Nao | Nao |
| `backup-backend-anterior-20261107/src/modules/alerts/` | Sim, dentro do backup | Nao |
| `backup-backend-anterior-20261107/src/modules/dashboard/` | Sim, dentro do backup | Nao |
| `backup-backend-anterior-20261107/src/modules/weather-data/weather-source.ts` | Sim, dentro do backup | Nao |
| `backup-backend-anterior-20261107/src/modules/weather-data/weather-data.mock.ts` | Sim, dentro do backup | Nao |
| `backup-backend-anterior-20261107/src/modules/market-data/market-data.mock.ts` | Sim, dentro do backup | Nao |

Busca feita em `src/**/*.ts`: nao houve referencia a `weather-source`, `weather-data.mock`, `market-data.mock`, `/api/alerts` ou `/api/dashboard`.

Em `src/app.ts`, somente os routers de auth, users, forecasts, market-data, sensors e weather-data sao ligados. As pastas `alerts` e `dashboard` nao existem no codigo atual.

A pasta `backup-backend-anterior-20261107/` pertence a uma copia antiga e nao esta importada pelo projeto atual. Ela nao foi alterada nem removida nesta rodada.

## Estado da migracao para PostgreSQL

| Arquivo/codigo | Estado atual | Validacao pendente |
|---|---|---|
| `prisma/schema.prisma` | Provider PostgreSQL; IDs primarios usam `String @id @default(uuid())`; FKs usam `String`; inclui OTP | Revisar o mapeamento com o responsavel pelo banco |
| `prisma/migrations/20261121000000_init_postgresql/migration.sql` | Migration inicial SQL gerada do schema atual | Revisar e aplicar somente no ambiente aprovado; nao foi executada |
| `prisma/migrations/migration_lock.toml` | Provider `postgresql` | — |
| `src/lib/ids.ts` | Valida UUID v4 num unico ponto | Confirmar dados existentes e atualizar IDs do ambiente |
| `src/app.ts` | `/health` usa `$queryRaw` com `SELECT 1` | Validar contra PostgreSQL quando houver ambiente autorizado |
| `package.json` | `db:migrate:dev`, `db:migrate:deploy` e `db:migrate:status`; `db:push` removido | Preparar/aplicar migrations apenas com aprovacao; nenhum comando foi executado |
| Testes, fixture e CI | IDs UUID e URL PostgreSQL de teste | Testes usam repositórios em memoria; CI executa testes sem conectar ao banco |

Nao ha referencias ativas ao provider antigo no codigo do projeto; a copia historica em `backup-backend-anterior-20261107/` foi preservada e adicionada ao `.gitignore`. Esta auditoria nao executou migrations nem comandos de banco.

## Resultado apos a Parte 1 (2026-11-20)

- `POST /api/sensors`: produtores agora podem criar sensor em talhao proprio; talhao inexistente ou de outro usuario devolve o mesmo 404. Administradores mantem acesso global e sao registrados.
- `PATCH /api/sensors/:id/status`: produtores podem alterar status do proprio sensor; sensor inexistente ou de outro usuario devolve o mesmo 404. Administradores mantem acesso global e sao registrados.
- `POST /api/sensors/:id/comandos`: nova rota para `LIGAR` e `DESLIGAR`, restrita ao dono ou ADMIN. O comportamento atual atualiza somente o status do sensor no banco e nao comanda o hardware.
- `GET /api/weather-data?sensorId=...`: ID inexistente ou de outro usuario agora retorna o mesmo 404. Sem `sensorId`, listagens ficam limitadas aos recursos de todo perfil nao-admin.
- Listagens de sensores e previsoes tambem limitam os perfis nao-admin aos dados proprios; acessos globais do ADMIN nessas listagens sao registrados.
- A politica provisoria tambem restringe `ANALISTA` aos proprios recursos quando a rota permite o perfil; rotas que ja negavam esse perfil continuam negando.
- A validacao central em `src/lib/ids.ts` agora aceita UUID v4, compativel com o schema PostgreSQL.
- Sobras da versao antiga nao existem na arvore atual `src/`. Os arquivos homonimos encontrados estao dentro de `backup-backend-anterior-20261107/` e possuem referencias internas; nenhum arquivo foi apagado.
- Na etapa original de IDOR, o schema e comandos de banco permaneceram intocados. Nesta atualizacao, o schema foi convertido para PostgreSQL, mas a integracao Prisma nao foi exercitada contra banco.

## Rotas OTP adicionadas (Parte 2)

| Metodo | Rota | Dados relevantes | Autorizacao | Controle |
|---|---|---|---|---|
| POST | `/api/auth/login` | E-mail e senha no corpo | Publica | Se OTP estiver ativo, devolve apenas desafio curto, sem token de sessao |
| POST | `/api/auth/login/otp` | `challengeToken` e exatamente um entre `code` e `recoveryCode` no corpo | Desafio JWT com finalidade OTP; limite por IP e usuario | Valida desafio, fator, janela e uso unico; falha OTP responde 401 generico |
| POST | `/api/auth/otp/setup` | Nenhum ID; usuario obtido da sessao | Autenticado | Guarda segredo cifrado como pendente e devolve URI e QR |
| POST | `/api/auth/otp/activate` | Codigo TOTP no corpo; usuario da sessao | Autenticado e limitado por IP/usuario | Ativa o fator atomicamente e devolve codigos de recuperacao apenas uma vez |
| POST | `/api/auth/otp/disable` | Senha e codigo TOTP no corpo; usuario da sessao | Autenticado e limitado por IP/usuario | Exige senha e TOTP; desativa e remove recuperacoes em transacao |
| POST | `/api/auth/otp/recovery-codes/regenerate` | Codigo TOTP no corpo; usuario da sessao | Autenticado e limitado por IP/usuario | Consome passo e troca hashes de recuperacao atomicamente |

As novas rotas nao recebem IDs de usuario no corpo ou URL. A identidade e derivada da sessao ou do `sub` do desafio verificado. O middleware `authenticate` recusa JWT com `purpose: "otp"`.

O repositório OTP seleciona `memory` ou `prisma` por `OTP_STORE`. O modo em memoria e proibido em producao. O Prisma foi gerado a partir da proposta de schema, mas nenhuma consulta de runtime foi validada com banco.

## Pendencias abertas

- Banco: PostgreSQL configurado no Prisma; migration inicial preparada, falta revisao e aplicacao em ambiente aprovado.
- Responsavel pela aplicacao do schema: nao confirmado; nenhum comando de banco foi executado.
- Politica por perfil: `ADMIN` e `ANALISTA` ainda precisam ser decididos para o controle de IDOR.
- Codigo de missao: nao confirmado; nao foi inventado e nao foi criado codigo de missao em variavel ou arquivo.
- Titulo da atividade: nao confirmado entre "Seguranca no Projeto Integrador" e "Seguranca no Servico em Nuvem".
- Politica do analista: pendente entre acesso somente a leitura de todos os dados ou acesso somente aos proprios recursos.
