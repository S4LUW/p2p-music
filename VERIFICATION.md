# Validação — 15/10/2026

- npm install e npm test concluídos: **14 testes aprovados**.
- npm audit --omit=dev: nenhuma vulnerabilidade reportada nesta execução.
- Backend HTTP real com PGlite local (engine PostgreSQL WASM), executando migrações,
  SQL transacional e autenticação scrypt. Sem mocks dos repositórios de dados.
- Cobertura: migrações idempotentes, autenticação e expiração, hashes de tokens,
  separação entre contas, faixas repetidas, ordenação, reenvios idempotentes,
  conflito e rollback de lote, edições concorrentes, exclusão/restauração,
  paginação com edições entre páginas, validação de entradas, CORS,
  limite de login, limite de corpo e revogação de todos os dispositivos.
- O teste concorrente local usa a serialização do PGlite. O lock entre conexões
  PostgreSQL independentes será verificado pelo segundo modo da suíte em CI.
- PostgreSQL externo, Docker e GitHub Actions ainda não executados nesta entrega.
  Docker/gh não estão disponíveis no ambiente local. O workflow inclui PostgreSQL
  16 e docker build, para execução após publicar o repositório.
- Nenhuma credencial de produção foi recebida ou gravada. Não houve deploy nem
  alteração no banco remoto ou no desktop existente.

Próximas verificações: workflow no GitHub, build/deploy no EasyPanel, health/ready,
login HTTPS com contas de teste e sincronização isolada. Depois, implementar
o cliente SQLite/outbox e login no desktop conforme SYNC.md.
