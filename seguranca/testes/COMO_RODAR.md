# Como rodar os testes de IDOR

Os testes automatizados de IDOR e OTP usam repositórios falsos em memoria e nao conectam ao banco. O teste OTP cria chaves aleatorias somente durante o processo; nao grava credenciais ou segredos em arquivos.

Na raiz do projeto:

```powershell
npm run check
npm run build
npm test
```

O arquivo `dados-exemplo.mjs` apenas imprime fixtures sinteticas; nao grava no banco:

```powershell
node seguranca/testes/dados-exemplo.mjs
```

## Testes HTTP antes/depois

Os scripts HTTP usam um ambiente de teste ja preparado com dois produtores, uma propriedade/talhao/sensor para cada um e um administrador. Nao use dados reais. O JSON dos fixtures esta em `dados-exemplo.json`; os IDs precisam corresponder aos registros criados no ambiente. A senha e o token devem ser obtidos por um fluxo de teste autorizado, nunca incluidos em arquivos ou logs.

Defina estas variaveis na sessao do PowerShell:

```powershell
$env:BASE_URL = "http://localhost:3333"
$env:TOKEN_PRODUTOR_A = "<token de teste>"
$env:SENSOR_A_ID = "<id do sensor A>"
$env:SENSOR_B_ID = "<id do sensor B>"
$env:TALHAO_B_ID = "<id do talhao B>"
```

Execute `node seguranca/testes/idor-antes.mjs` contra a versao-base anterior as mudancas e `node seguranca/testes/idor-depois.mjs` contra a versao com o controle. Os scripts imprimem apenas os status HTTP e falham quando o resultado diverge do esperado.

O teste `antes` documenta o comportamento observado na versao-base: produtores nao podiam alterar status ou criar sensores (403), a consulta de leituras filtrava silenciosamente os sensores de terceiros (200 vazio), e a rota de comando ainda nao existia. Nao remova protecoes para fabricar uma vulnerabilidade nem grave evidencias que nao foram geradas por execucao real.

O teste `depois` verifica que o dono consegue ler, alterar status e enviar comando; IDs de terceiros retornam 404, inclusive em `sensorId` e `talhaoId`. A rota de comando atualmente atualiza o campo de status no banco; ela nao envia comando ao ESP32 nem ao ThingSpeak.

Os scripts HTTP alteram o status do sensor A para `ATIVO` e tentam criar com identificador de prova apenas contra o talhao de B, que deve ser recusado. Use somente uma base descartavel de testes.

## Testes HTTP OTP antes/depois

Use uma conta descartavel que ainda nao tenha OTP ativo e defina os valores somente na sessao do terminal:

```powershell
$env:BASE_URL = "http://localhost:3333"
$env:OTP_TEST_EMAIL = "<email ficticio da conta de teste>"
$env:OTP_TEST_PASSWORD = "<senha definida fora do repositorio>"
$env:OTP_TEST_WINDOW = "1"
```

`node seguranca/testes/otp-antes.mjs` deve ser executado contra a versao-base: senha correta devolve token sem pedir OTP. `node seguranca/testes/otp-depois.mjs` deve ser executado contra a versao com OTP: ele ativa o fator, usa o segredo somente em memoria para gerar codigos de teste e confere desafio sem sessao, codigo errado/vencido/valido/reutilizado, codigo de recuperacao de uso unico e limite de tentativas. O script imprime somente resultados HTTP, nunca imprime segredo, token, codigo, email ou senha.

O script `depois` ativa OTP na conta e nao a desativa; use uma conta descartavel nova a cada execucao. Limites HTTP podem permanecer no processo ate a janela expirar ou a API reiniciar.

## Configuracao local da API

Copie `.env.example` para `.env` fora do Git e preencha `OTP_ENCRYPTION_KEY` com Base64 de 32 bytes aleatorios, alem das outras variaveis obrigatorias. Nunca use valores deste documento como credenciais. Para testar persistencia real, o banco/schema precisa ser aprovado e preparado pelo responsavel; esta entrega nao executa nem exige comandos de banco para a suite automatizada.

O provider configurado e PostgreSQL. `DATABASE_URL` deve ser uma URL PostgreSQL do ambiente aprovado. A migration inicial esta em `prisma/migrations/20261121000000_init_postgresql/migration.sql`; revise-a antes de aplicar. Use `npm run db:migrate:dev` em desenvolvimento e `npm run db:migrate:deploy` em implantacao. Nenhum desses comandos foi executado nesta entrega. Os testes automatizados usam repositorios em memoria e nao exigem servidor PostgreSQL.
