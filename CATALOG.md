# Catálogo e curadoria

## Ativação

1. Publique a API atualizada e use **Implementar** no EasyPanel. O Dockerfile executa a migration `003_catalog.sql` automaticamente antes de iniciar. Ela acrescenta as tabelas de artistas, álbuns e faixas e a permissão `accounts.is_curator`, sem alterar playlists.
2. No terminal do serviço da API, autorize uma conta já existente:

```sh
CURATOR_EMAIL='seu-email-da-conta' CURATOR_ENABLED=true npm run curator:set
```

Para revogar, execute novamente com `CURATOR_ENABLED=false`. Este comando é administrativo e usa a conexão interna já configurada. Não exige senha da conta. Ninguém pode se promover pelo desktop ou pela API pública.

3. Recompile o desktop com `npm run desktop:build`, entre na conta e abra **Curadoria**. Se já estava na página, clique em **Atualizar lista**.

## Fluxo

- **Artista:** incluir/editar nome e biografia. Clique no cartão para abrir sua discografia.
- **Álbum:** incluir/editar título, ano opcional e gênero. Clique no cartão para abrir as faixas.
- **Música:** incluir/editar título, disco, número da faixa, duração opcional em segundos e arquivo MP3. Use um arquivo compartilhado ou selecione um arquivo pelo formulário; o núcleo calcula o SHA-256.
- Publicações ficam visíveis imediatamente para todas as contas autenticadas, pela página **Catálogo**. Todos os curadores autorizados podem editar o catálogo compartilhado. Não há exclusão, rascunhos ou aprovação editorial nesta etapa.
- Artistas têm busca por nome; páginas de artistas, álbuns e faixas retornam até 50 itens. A busca inicial usa correspondência literal, sem diferenciar maiúsculas, no nome do artista; busca global de músicas e álbuns fica para outra etapa. Imagens são marcadores com iniciais, sem hospedagem de capas nesta versão.
- A página de álbum permite adicionar músicas às playlists e procurar o SHA-256 em até 32 peers já conectados (quatro consultas simultâneas) para tocar/adicionar à fila. Isso não implementa ainda um índice global de fontes. A ausência de fonte não remove o cadastro.

## Arquivos e disponibilidade

Somente metadados e SHA-256 ficam no PostgreSQL. Nenhum MP3 é enviado à API. A seleção compartilha o arquivo durante a sessão atual, como a Biblioteca existente. Ao reiniciar o desktop, selecione novamente os MP3 para disponibilizá-los; o catálogo permanece salvo no servidor. Selecionar e depois cancelar o formulário não desfaz esse compartilhamento, que pode ser encerrado pela Biblioteca.

Trocar o arquivo de uma faixa altera a referência no catálogo; playlists já salvas conservam o SHA-256 anterior. A duração é informada manualmente nesta etapa. A reprodução consulta outros peers; não há novo player para arquivos locais.

## Contrato e integridade

`GET /v1/catalog?kind=artist&q=texto&offset=0` retorna `{curator,items,nextOffset}`. Para `kind=album`, `parent` é o UUID do artista; para `kind=track`, é o UUID do álbum. Exige sessão válida.

`POST /v1/catalog` aceita objeto com `kind`, UUID `id` e `version` (zero para criar; versão recebida para editar), mais os campos do tipo. Exige permissão de curador conferida no servidor a cada escrita. Retorna `{item}`. Edições usam bloqueio de linha e versão para impedir sobrescritas concorrentes; 409 exige recarregar o cadastro. Uma posição `(álbum,disco,faixa)` só pode ser usada uma vez. Vínculos de pai são imutáveis nesta versão.

UUID é criado pelo desktop e conservado durante uma tentativa: repetir uma criação após perda de resposta gera conflito, não uma segunda música. Nesse caso, atualize a lista antes de tentar novamente. Cadastros exigem internet, sem fila offline de publicação nesta versão. Tokens permanecem no núcleo Rust e não são enviados ao React.

Há limite de 30 escritas/minuto/conta além dos limites gerais. Consultas são parametrizadas, textos limitados e arquivos limitados a 100 MiB. A migration é transacional e idempotente através do registro de migrations.
