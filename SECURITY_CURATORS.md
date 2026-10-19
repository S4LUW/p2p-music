# Revisão de segurança da curadoria — 2026-10-18

## Escopo e conclusão

Revisão local da API, cadastro, login, sessões, catálogo, SQL e comando administrativo. Não é pentest do servidor em produção nem garantia de ausência de vulnerabilidades. Não foram acessados segredos ou alteradas contas no servidor.

Não foi encontrado caminho HTTP que permita ao leitor promover a própria conta. Cadastro/login usam esquemas estritos; a identidade vem da sessão opaca aleatória (32 bytes), cujo hash é armazenado no banco. Publicações consultam `accounts.is_curator` no servidor a cada escrita, com bloqueio de linha dentro da transação. Campos enviados pelo cliente e o botão exibido no desktop não concedem permissão. SQL usa parâmetros; os nomes de tabelas/colunas do catálogo vêm de listas fixas.

## Reforços implementados

- A autorização de escrita exige o booleano `true` explicitamente.
- O helper interno de criação de contas também rejeita propriedades extras.
- `curator:set` exige uma conexão administrativa explícita em `ADMIN_DATABASE_URL`, um booleano válido e um motivo de 8–500 caracteres.
- Promoção e revogação encerram todas as sessões da conta, evitando que tokens emitidos antes da promoção ganhem privilégios automaticamente. É necessário fazer login novamente. Repetir o mesmo perfil é uma operação sem alteração.
- Mudança de perfil, encerramento das sessões e auditoria são uma transação única. Se a auditoria falhar, tudo é revertido.
- Migração `004_curator_audit.sql` registra conta, estado anterior/novo, motivo, horário e usuário do banco. A trilha cobre o comando administrativo; um administrador pleno do banco ainda pode fazer SQL direto e alterar dados.
- `scripts/runtime-role.sql` prepara um usuário restrito: não pode inserir/alterar `is_curator`, mudar o esquema, criar privilégios nem modificar a auditoria. A aplicação mantém acesso às operações necessárias para autenticação, playlists e catálogo.

## Publicação imediata

Publique a API e reimplante no EasyPanel. O comportamento padrão continua aplicando migrações na inicialização; a migração 004 é necessária. Nenhum desktop precisa ser recompilado para esses controles. Nenhuma conta existente é promovida/rebaixada ou desconectada apenas por instalar esta atualização.

## Separação de credenciais no PostgreSQL (ação administrativa pendente)

Não foi possível verificar os privilégios reais do banco de produção. Não basta ter o script no repositório: é necessário aplicá-lo para que esta camada de defesa esteja ativa.

1. Faça a migração com o usuário administrador atual antes de restringir a API.
2. Em conexão administrativa ao banco exclusivo da aplicação, execute `scripts/runtime-role.sql`. O script cria uma role nova e falha se ela já existir; não reaplique às cegas. Ele também remove CREATE de PUBLIC no esquema public, portanto use-o apenas no banco dedicado da aplicação.
3. Configure uma senha forte e LOGIN para `p2p_music_runtime` por um canal administrativo seguro (em psql, `\password p2p_music_runtime` e `ALTER ROLE p2p_music_runtime LOGIN;`). Não coloque a senha no Git, em prints ou no chat.
4. Troque `DATABASE_URL` da API para esse usuário. Use o hostname INTERNO do PostgreSQL, conservando o banco e a configuração TLS apropriada. Defina `MIGRATE_ON_START=false` e reimplante.
5. Confirme `/health/ready`, cadastro, login, sincronização e publicação de um curador. O usuário restrito não deve ser proprietário do banco/esquema/tabelas nem membro de outra role privilegiada. Revise também grants preexistentes para PUBLIC, inclusive funções SECURITY DEFINER de terceiros; o script não revoga privilégios de outros projetos.
6. Nas próximas atualizações que contenham SQL, execute `npm run migrate` em uma tarefa administrativa separada com DATABASE_URL administrativa, antes do deploy. Revise os grants quando novas tabelas/colunas forem adicionadas. Não salve a senha administrativa nas variáveis permanentes da API.

Para alterar curadoria, execute `npm run curator:set` em uma sessão administrativa temporária com `ADMIN_DATABASE_URL`, `CURATOR_EMAIL`, `CURATOR_ENABLED=true` (ou false) e `CURATOR_REASON`. Remova essas variáveis da sessão ao terminar. O programa não imprime tokens ou a conexão. Restrinja acesso ao EasyPanel, banco e repositório; use MFA nessas contas administrativas.

## Testes e limites

A suíte `test/curator-security.test.js` cobre campos de privilégios forjados, tentativa de usar o ID de um curador, cabeçalhos falsos, tokens inválidos, criação/edição de artistas/álbuns/faixas por leitores, ausência de endpoint público de promoção, revogação, auditoria e rollback, além de privilégios reais de uma role no PostgreSQL embarcado PGlite. Os demais testes da API também devem passar.

O teste local não verifica firewall, exposição pública do PostgreSQL, credenciais reais, configuração do proxy ou acessos ao painel. Credenciais válidas roubadas de um curador permitem atuar como esse curador; MFA no login de curadores ainda não está implementado. Hash de arquivo verifica integridade, não segurança do conteúdo.

**Distinção importante:** proteger a publicação do catálogo não significa que o protocolo P2P só aceite arquivos do catálogo. O compartilhamento manual e os inventários anunciados pelos peers ainda precisam de uma política própria de hashes aprovados se a exigência for bloquear toda circulação/replicação de MP3 não catalogado. Essa revisão não adiciona uma lista de permissão ao protocolo P2P.

Referência: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html (negar por padrão e validar permissões em cada requisição).

## Resultado da execução local

43 testes da API aprovados, incluindo os 5 grupos novos de segurança. `npm audit --omit=dev` reportou zero vulnerabilidades conhecidas nas dependências de produção. Os testes HTTP foram executados pela suíte npm autorizada; uma execução direta anterior foi bloqueada pelo sandbox em localhost e não foi tratada como evidência de falha da aplicação.
