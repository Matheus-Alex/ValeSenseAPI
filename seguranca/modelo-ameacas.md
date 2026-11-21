# Modelo de ameacas — IDOR

## Escopo

Este rascunho cobre a autorizacao de acesso a sensores, talhoes, leituras, previsoes e alertas da API ValeSense. A cadeia de propriedade usada pelo backend e `Usuario -> Propriedade -> Talhao -> Sensor -> LeituraClimatica`; previsoes pertencem a talhoes e alertas pertencem a previsoes.

## Ativos e fronteiras de confianca

- Dados de leituras climaticas, status e configuracao de sensores.
- Identificadores de sensores e talhoes recebidos em URL, query string ou corpo.
- Token JWT e identidade/role carregadas da sessao autenticada.
- Banco Prisma, acessado pela API.

O cliente e considerado nao confiavel: conhecer ou trocar um ID nao concede acesso. A autorizacao deve derivar a identidade do JWT validado e a propriedade do banco.

## Ameacas

| Ameaca | Controle aplicado | Risco residual |
|---|---|---|
| Produtor altera um ID para consultar leituras do sensor de outro produtor (IDOR) | Verificacao server-side do dono; inexistente e de terceiro respondem com o mesmo 404; listas filtram por usuario | Administradores continuam com acesso global, registrado em log |
| Produtor envia `talhaoId` de outro produtor ao criar sensor | A mesma verificacao de propriedade e aplicada ao talhao antes da criacao | Nao ha teste de persistencia enquanto banco/provider e ambiente nao estiverem definidos |
| Produtor altera status ou tenta comandar sensor de outro produtor | Verificacao de dono antes de atualizar status ou aceitar `LIGAR`/`DESLIGAR` | A rota de comando so atualiza status no banco; integracao fisica com ESP32/ThingSpeak nao existe |
| Atacante enumera IDs existentes | Formato malformado retorna 400; recurso inexistente e recurso de outro usuario retornam a mesma resposta 404 | Diferencas de tempo de consulta ao banco podem existir; rate limits nao foram especificamente ajustados nesta etapa |
| Role `ANALISTA` acessa recursos de produtor | Politica provisoria: todos os perfis exceto `ADMIN` ficam restritos aos proprios recursos; listagens foram filtradas | A politica precisa de confirmacao do grupo; interfaces de negocio podem esperar acesso analitico global |

## Decisoes e limites

- `ADMIN` acessa todos os recursos e essa atividade e registrada pelo log de seguranca.
- `ANALISTA` e `PRODUTOR_EXPORTADOR` ficam limitados aos recursos do usuario autenticado nesta implementacao provisoria.
- O log identifica a missao por `MISSION_CODE`; se nao estiver configurado, usa `SEM-CODIGO` e avisa na inicializacao.
- Nenhum teste desta etapa requer banco ou dados reais. O teste HTTP so deve ser executado em ambiente descartavel preparado com dados sinteticos.
- O controle nao trata JWT roubado, autenticacao multifator, brute force de OTP, comprometimento do banco nem seguranca da rede do dispositivo.
