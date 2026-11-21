# Proposta de schema para OTP

O schema Prisma desta branch recebeu os campos e modelo abaixo para revisao. O provider agora e PostgreSQL, mas nenhuma migration ou escrita de dados foi executada. O responsavel pelo banco deve revisar e aplicar a alteracao somente no ambiente aprovado.

No modelo `Usuario`:

```prisma
/// Campos do segundo fator, adicionados para revisao antes de aplicar no banco.
otpAtivo            Boolean                @default(false) @map("otp_ativo")
otpSegredoCifrado   String?                @map("otp_segredo_cifrado")
otpUltimoPasso      Int?                   @map("otp_ultimo_passo")
codigosRecuperacao  CodigoRecuperacao[]
```

Modelo novo para PostgreSQL:

```prisma
/// Codigos OTP de recuperacao armazenados somente como hash.
model CodigoRecuperacao {
  id         String    @id @default(uuid())
  usuarioId  String    @map("usuario_id")
  codigoHash String    @map("codigo_hash")
  usadoEm    DateTime? @map("usado_em")
  criadoEm   DateTime  @default(now()) @map("criado_em")
  usuario    Usuario   @relation(fields: [usuarioId], references: [id], onDelete: Cascade)

  @@index([usuarioId])
  @@map("codigo_recuperacao")
}
```

`otpUltimoPasso` registra o passo TOTP aceito mais recente. A implementacao Prisma usa `updateMany` com condicao `otpUltimoPasso` nulo ou menor que o passo recebido e confirma `count === 1`. O consumo de codigo de recuperacao tambem e uma atualizacao condicional em que `usadoEm` ainda e nulo.

Os IDs e chaves estrangeiras do schema agora usam `String` com UUID, sem anotacoes especificas de outro banco. Os nomes snake_case preservados por `@map` sao nomes de colunas do PostgreSQL. O arquivo `prisma/migrations/migration_lock.toml` declara `postgresql`, e a migration inicial esta em `prisma/migrations/20261121000000_init_postgresql/migration.sql`. Ela foi gerada, mas nao aplicada; revise-a antes de usar em um ambiente aprovado.
