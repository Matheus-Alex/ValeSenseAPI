-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "usuario" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "cpf" TEXT,
    "senha" TEXT NOT NULL,
    "perfil" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "otp_ativo" BOOLEAN NOT NULL DEFAULT false,
    "otp_segredo_cifrado" TEXT,
    "otp_ultimo_passo" INTEGER,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propriedade" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "area_total" DOUBLE PRECISION NOT NULL,
    "localizacao" TEXT NOT NULL,
    "unidade_area" TEXT NOT NULL,

    CONSTRAINT "propriedade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "talhao" (
    "id" TEXT NOT NULL,
    "propriedade_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "area" DOUBLE PRECISION NOT NULL,
    "unidade_area" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',

    CONSTRAINT "talhao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensor" (
    "id" TEXT NOT NULL,
    "talhao_id" TEXT NOT NULL,
    "identificador" TEXT NOT NULL,
    "canal_thingspeak" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',

    CONSTRAINT "sensor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leitura_climatica" (
    "id" TEXT NOT NULL,
    "sensor_id" TEXT NOT NULL,
    "temperatura" DOUBLE PRECISION NOT NULL,
    "umidade" DOUBLE PRECISION NOT NULL,
    "data_hora" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leitura_climatica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dado_mercado" (
    "id" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "data_referencia" TIMESTAMP(3) NOT NULL,
    "preco" DOUBLE PRECISION NOT NULL,
    "demanda" TEXT,
    "unidade_preco" TEXT,

    CONSTRAINT "dado_mercado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "previsao" (
    "id" TEXT NOT NULL,
    "talhao_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "data_inicio" TIMESTAMP(3) NOT NULL,
    "data_fim" TIMESTAMP(3) NOT NULL,
    "gerada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confianca" DOUBLE PRECISION,

    CONSTRAINT "previsao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerta" (
    "id" TEXT NOT NULL,
    "previsao_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "nivel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacao" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "alerta_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracao" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "valor" TEXT,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_recuperacao" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expiracao" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "token_recuperacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_acesso" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "acao" TEXT NOT NULL,
    "endereco_ip" TEXT,
    "user_agent" TEXT,
    "resultado" TEXT NOT NULL,
    "data_hora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_acesso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "codigo_recuperacao" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "codigo_hash" TEXT NOT NULL,
    "usado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codigo_recuperacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_cpf_key" ON "usuario"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "sensor_identificador_key" ON "sensor"("identificador");

-- CreateIndex
CREATE INDEX "leitura_climatica_data_hora_idx" ON "leitura_climatica"("data_hora");

-- CreateIndex
CREATE INDEX "dado_mercado_produto_data_referencia_idx" ON "dado_mercado"("produto", "data_referencia");

-- CreateIndex
CREATE UNIQUE INDEX "uq_configuracao_usuario_chave" ON "configuracao"("usuario_id", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "token_recuperacao_token_hash_key" ON "token_recuperacao"("token_hash");

-- CreateIndex
CREATE INDEX "token_recuperacao_usuario_id_idx" ON "token_recuperacao"("usuario_id");

-- CreateIndex
CREATE INDEX "log_acesso_data_hora_idx" ON "log_acesso"("data_hora");

-- CreateIndex
CREATE INDEX "codigo_recuperacao_usuario_id_idx" ON "codigo_recuperacao"("usuario_id");

-- AddForeignKey
ALTER TABLE "propriedade" ADD CONSTRAINT "propriedade_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "talhao" ADD CONSTRAINT "talhao_propriedade_id_fkey" FOREIGN KEY ("propriedade_id") REFERENCES "propriedade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor" ADD CONSTRAINT "sensor_talhao_id_fkey" FOREIGN KEY ("talhao_id") REFERENCES "talhao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leitura_climatica" ADD CONSTRAINT "leitura_climatica_sensor_id_fkey" FOREIGN KEY ("sensor_id") REFERENCES "sensor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "previsao" ADD CONSTRAINT "previsao_talhao_id_fkey" FOREIGN KEY ("talhao_id") REFERENCES "talhao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_previsao_id_fkey" FOREIGN KEY ("previsao_id") REFERENCES "previsao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_alerta_id_fkey" FOREIGN KEY ("alerta_id") REFERENCES "alerta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracao" ADD CONSTRAINT "configuracao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_recuperacao" ADD CONSTRAINT "token_recuperacao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_acesso" ADD CONSTRAINT "log_acesso_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codigo_recuperacao" ADD CONSTRAINT "codigo_recuperacao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
