# Ilustrações do catálogo

Artistas e álbuns possuem o campo opcional `illustrationUrl`. Apenas a URL é armazenada no PostgreSQL. O desktop carrega a imagem diretamente do provedor externo, sem upload ou proxy na API.

Use uma URL HTTPS que retorne a imagem diretamente (não uma resposta JSON de uma API). URLs com usuário/senha não são aceitas. O limite é de 2048 caracteres. Campo vazio ou null remove a ilustração; clientes antigos que omitem o campo preservam a imagem existente. Se a imagem não carregar, o desktop mostra a inicial.

## Atualização com usuário restrito

1. Publique esta versão do código no GitHub.
2. Antes de implantar a nova API, execute `npm run migrate` em uma tarefa administrativa separada, com `DATABASE_URL` administrativa temporária apontando para o banco da aplicação. Isso aplica `migrations/005_catalog_illustrations.sql` e registra a migração, sem repetir as anteriores.
3. Mantenha a API com `DATABASE_URL` do usuário `p2p_music_runtime` e `MIGRATE_ON_START=false`. Não deixe a credencial administrativa nas variáveis permanentes da API.
4. Implante a API e atualize o desktop. Valide cadastrar, editar e remover a URL de um artista e de um álbum.

Não execute novamente `scripts/runtime-role.sql`: a role já existe. Os grants de SELECT/INSERT/UPDATE nas tabelas do catálogo também se aplicam às novas colunas; não é necessário recriar a role.
