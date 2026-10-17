# P2P Music API

API de contas e sincronização de playlists para o protótipo P2P Music.
Node.js 22+, PostgreSQL, sem armazenamento ou retransmissão de áudio.
O identificador `file.id` é o SHA-256 hexadecimal do arquivo exato, compatível
com o desktop. Entradas têm UUID próprio para permitir a mesma faixa repetida.

## Estado desta entrega

Implementados: cadastro pelo desktop com e-mail e senha, sessões revogáveis por
dispositivo, playlists sincronizadas com SQLite/outbox no cliente, catálogo,
descoberta de peers e coordenação de replicação cooperativa de músicas.

Recuperação de senha, confirmação de e-mail e rotina operacional de backup ainda
não estão implementadas. O cadastro não verifica a posse do endereço informado.

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

## Cadastro e sessões

O aplicativo oferece **Criar conta** com somente e-mail e senha (12–256 caracteres).
`POST /v1/auth/register` recebe `{ "email": "...", "password": "...", "deviceId": "UUID" }`.
O desktop gera o identificador de dispositivo automaticamente. E-mails são normalizados
com trim e minúsculas; a senha mantém seu valor exato e é armazenada com scrypt e salt.
O cadastro retorna **201** com `{ token, expiresAt, accountId }` e já inicia a sessão.
Conta e sessão são criadas na mesma transação; novos usuários não são curadores.
Campos extras são rejeitados, inclusive permissões. E-mail duplicado retorna **409**,
sem substituir conta, senha ou sessões existentes; nesse caso, use Entrar.
Não há envio de e-mail nesta etapa. Se a resposta se perder após o envio, tente fazer login.

Para criar uma conta administrativamente no console do serviço,
defina temporariamente `ACCOUNT_EMAIL` e `ACCOUNT_PASSWORD` (12–256 caracteres)
e execute `npm run account:create`. Remova essas duas variáveis depois.
Não envie senhas em commits, argumentos de comando ou mensagens do chat.
O comando grava scrypt com salt individual e imprime somente o UUID da conta.

Login: `POST /v1/auth/login` com `{ "email": "...", "password": "...", "deviceId": "UUID" }`.
A resposta fornece token opaco, validade de sete dias e accountId.
Use `Authorization: Bearer <token>`. Somente o hash do token fica no banco.
Um novo login do mesmo dispositivo revoga o token anterior. São permitidas
até 20 sessões ativas por conta. `POST /v1/auth/logout` revoga a sessão atual;
`POST /v1/auth/logout-all` revoga todas. O desktop guarda o token protegido pelo Windows (DPAPI), separado do SQLite; o token não é exposto à interface React.

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
- Login: 20 por minuto/endereço; cadastro: 5 por minuto/endereço (inclusive tentativas inválidas).
  Login e cadastro compartilham o limite de duas derivações de senha simultâneas por instância.
  Corpos de autenticação são limitados a 4 KiB; excesso de tentativas retorna 429 e Retry-After: 60.
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

O catálogo compartilhado e a autorização de curadores estão descritos em [CATALOG.md](CATALOG.md), incluindo o comando administrativo para habilitar uma conta.

Veja [SYNC.md](SYNC.md). Conflitos retornam 409, sem substituir alterações de outro
dispositivo. Esta primeira versão não faz mesclagem automática de edições concorrentes.

Fontes técnicas: [transações node-postgres](https://node-postgres.com/features/transactions),
[PGlite](https://pglite.dev/docs/), [serviço App do EasyPanel](https://easypanel.io/docs/services/app).

## Publicação do cadastro

Atualize a API no GitHub e faça o deploy no EasyPanel antes de distribuir o novo desktop.
Não são necessárias novas variáveis de ambiente, serviço de e-mail ou migração de schema.
Depois, recompile o desktop para incluir o comando nativo `account_register`.
