# Publicar no EasyPanel

## GitHub

Crie um repositório privado `p2p-music-api` na conta/organização escolhida e envie
o conteúdo desta pasta na raiz. Inclua `package-lock.json`; exclua node_modules,
`.env`, senhas e backups. O workflow de testes roda ao enviar commits e abrir PRs.
Não foi criado repositório remoto automaticamente nesta entrega.

## Serviço de aplicação

No projeto existente **p2p-music**, crie um serviço **App** chamado **p2p-music-api**.
Selecione o repositório e a branch na origem GitHub. Para repositórios privados,
configure a autorização do GitHub no EasyPanel. Escolha o builder **Dockerfile**,
arquivo `Dockerfile`, contexto na raiz. A aplicação escuta em **3000**.

Configure as variáveis no serviço:

```dotenv
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DATABASE_URL=postgresql://postgresp2p:SENHA_CODIFICADA@HOST_INTERNO:5432/postgresp2p
ALLOWED_ORIGINS=http://tauri.localhost,https://tauri.localhost,tauri://localhost
```

Copie **HOST_INTERNO e porta** da conexão interna exibida no serviço `p2p-music-db`.
O URL `https://46.202.148.115/projects/p2p-music` é do painel administrativo, não é
o endereço de conexão PostgreSQL nem o endereço da API. Não adivinhe o hostname.
Caracteres reservados da senha precisam ser codificados para uso em URL.
Use apenas a rede interna; não é necessário publicar a porta do banco.

A credencial inicial precisa criar as tabelas no banco exclusivo `postgresp2p`.
Antes de ampliar para produção, separe a credencial de migração da credencial de
runtime e execute migrações como etapa de implantação. O usuário de runtime
precisa apenas das operações das tabelas do aplicativo, sem privilégios de superuser.

O container inicia aplicando as migrações pendentes em transação, com lock para
evitar que duas instâncias migrem juntas. Uma falha impede o início da API.
Mantenha a API em uma instância no piloto. Comece medindo memória, CPU, latência,
conexões e crescimento do banco antes de aumentar réplicas.

## Domínio e verificação

Adicione um domínio HTTPS apontando para a porta interna **3000** da aplicação.
O endereço pode ser um subdomínio próprio ou o fornecido pelo painel, desde que
tenha certificado válido. Esse será o endereço usado pelo desktop.

- `GET https://DOMINIO/health/live`: processo ativo.
- `GET https://DOMINIO/health/ready`: acesso ao banco/migrações.
- `GET https://DOMINIO/v1/sync` sem token deve responder **401**.

Crie duas contas de teste pelo console conforme README e verifique que cada uma
recebe apenas suas playlists. A autenticação real via HTTPS e a configuração
do PostgreSQL externo precisam ser verificadas após o deploy.

Para testes no navegador Vite, acrescente explicitamente a origem usada, por
exemplo `http://127.0.0.1:1420`, à lista ALLOWED_ORIGINS. Não use wildcard.

## Backup e migração futura

Configure backups automáticos do banco, criptografados e enviados a armazenamento
fora desse servidor, com retenção definida. Faça um teste de restauração em outro
banco antes de considerar as playlists protegidas. Não há agendador de backup
embutido nesta API.

Para migrar: interrompa temporariamente as escritas, exporte o banco completo
com pg_dump em formato custom, restaure com pg_restore em banco vazio compatível,
valide contas/playlists/recibos, ajuste DATABASE_URL e retome. Preserve UUIDs,
versões, recibos e revisões. Manter o domínio da API evita mudar o desktop.
Conserve o backup anterior até validar o ambiente novo. Após novas escritas no
ambiente novo, não retorne ao banco antigo sem reconciliar essas alterações.

Referência: [App service](https://easypanel.io/docs/services/app) e
[builders](https://easypanel.io/docs/builders) do EasyPanel.
