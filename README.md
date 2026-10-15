# P2P Music API

API de contas e sincronização de playlists para o protótipo P2P Music.
Node.js 22+, PostgreSQL, sem armazenamento ou retransmissão de áudio.
O identificador `file.id` é o SHA-256 hexadecimal do arquivo exato, compatível
com o desktop. Entradas têm UUID próprio para permitir a mesma faixa repetida.

## Estado desta entrega

Implementados: sessões revogáveis por dispositivo, comandos administrativos de
criação de contas, playlists ordenadas, alterações em lotes atômicos, controle de
versão, reenvio idempotente, sincronização incremental paginada e exclusão recuperável.

Ainda não implementados: tela de login/playlist no desktop, banco SQLite e outbox
do cliente, cadastro público, recuperação de senha/email, localização de peers
por hash, biblioteca cooperativa e rotina operacional de backup.
A fila de reprodução atual do desktop não foi modificada nesta entrega.

## Desenvolvimento

```sh
npm ci
npm test
```

Os testes locais usam PGlite (PostgreSQL compilado para WASM), não mocks de SQL.
Para repetir a suíte contra um PostgreSQL de testes, configure `TEST_DATABASE_URL`
e execute `npm test`. Ela cria e remove somente um schema de nome aleatório
`test_<uuid>`. Use um banco de testes com permissão de criar schemas, nunca a
credencial de produção. O workflow GitHub executa ambos os modos e constrói a imagem.

Para rodar a API com um banco real:

1. Configure `DATABASE_URL` no ambiente (modelo em `.env.example`).
2. Execute `npm run migrate`.
3. Execute `npm start`.

Arquivos `.env` não são carregados automaticamente. Para uso local opcional:
`node --env-file=.env scripts/migrate.js` e `node --env-file=.env src/server.js`.
Não desabilite a verificação de certificados para conexões TLS externas.

## Contas de teste

Não há registro público nesta versão. No console administrativo do serviço,
defina temporariamente `ACCOUNT_EMAIL` e `ACCOUNT_PASSWORD` (12–256 caracteres)
e execute `npm run account:create`. Remova essas duas variáveis depois.
Não envie senhas em commits, argumentos de comando ou mensagens do chat.
O comando grava scrypt com salt individual e imprime somente o UUID da conta.

Login: `POST /v1/auth/login` com `{ "email": "...", "password": "...", "deviceId": "UUID" }`.
A resposta fornece token opaco, validade de sete dias e accountId.
Use `Authorization: Bearer <token>`. Somente o hash do token fica no banco.
Um novo login do mesmo dispositivo revoga o token anterior. São permitidas
até 20 sessões ativas por conta. `POST /v1/auth/logout` revoga a sessão atual;
`POST /v1/auth/logout-all` revoga todas. O desktop deverá guardar o token no
armazenamento seguro do sistema, separado do SQLite.

## Implantação

Veja [EASYPANEL.md](EASYPANEL.md) para o projeto `p2p-music`, serviço de banco
`p2p-music-db`, database/usuário `postgresp2p`. Nenhuma conexão foi feita ao servidor
externo durante o desenvolvimento. O endereço interno real deve ser copiado do painel.

## Limites iniciais e operação

- Pool de cinco conexões por instância; SQL limitado a dez segundos.
- Até 50 operações / 128 KiB por push e 20 playlists por página de pull.
- 500 playlists por conta (incluindo excluídas), 1000 entradas por playlist.
- Metadados: nome de playlist até 200 caracteres, arquivo até 255; MP3 até 100 MiB.
- 120 requisições autenticadas por minuto/conta e 600 por minuto/endereço de socket.
- Login: 20 por minuto/endereço e duas derivações de senha simultâneas por instância.
  Atrás do proxy, o limite por socket pode ser compartilhado por todos os usuários.
  Não confiamos em X-Forwarded-For enviado pelo cliente. Antes de ampliar o piloto,
  configure limites na borda e uma política explícita de proxies confiáveis.
- Limites de requisição residem em memória; não são uma cota global entre réplicas.
- Recibos de operações e tombstones não são removidos automaticamente. Isso conserva
  reenvios e restauração; monitore o tamanho e defina retenção junto de um protocolo
  de ressincronização antes de executar qualquer limpeza.
- Exclusão recuperável não substitui backups: alterações anteriores de nome/ordem
  não têm histórico completo nesta versão.

## Contrato

Veja [SYNC.md](SYNC.md). Conflitos retornam 409, sem substituir alterações de outro
dispositivo. Esta primeira versão não faz mesclagem automática de edições concorrentes.

Fontes técnicas: [transações node-postgres](https://node-postgres.com/features/transactions),
[PGlite](https://pglite.dev/docs/), [serviço App do EasyPanel](https://easypanel.io/docs/services/app).
