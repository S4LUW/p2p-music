# Relay P2P no EasyPanel

Serviço separado da API HTTP. Encaminha bytes criptografados entre peers; não armazena músicas. A API continua responsável apenas pelos metadados. O relay mantém reservas de controle e transporta áudio quando a conexão direta não funciona.

## Instalação

1. Publique esta pasta no mesmo repositório GitHub da API.
2. No projeto `p2p-music`, crie uma aplicação `p2p-relay` usando esse repositório/branch.
3. Configure o caminho de build como `/relay` e o Dockerfile como `Dockerfile` (contexto de build: esta pasta).
4. Adicione um volume persistente montado em `/data`. O processo usa UID/GID `10001`; esse usuário precisa escrever no volume.
5. Variáveis: `RELAY_PUBLIC_IP=46.202.148.115`, `RELAY_PORT=4001`, `RELAY_DATA_DIR=/data`.
6. Publique a porta **TCP 4001 do servidor para TCP 4001 do container** e libere-a no firewall do servidor/provedor. Um domínio HTTPS não substitui esta publicação TCP.
7. Faça o deploy. Nos logs, copie a linha `P2P_MUSIC_RELAYS=/ip4/46.202.148.115/tcp/4001/p2p/...` com o PeerId real gerado.
8. Adicione essa variável à aplicação **da API** e reimplante a API. Não use um PeerId de exemplo.
9. Recompile e atualize ambos os desktops. Aguarde até dois ciclos de presença (aproximadamente 140 segundos) para a reserva e seu endereço aparecerem no catálogo de fontes.

Não apague `/data/identity.key`: ele preserva o endereço do relay entre deploys. Se for perdido, atualize o PeerId configurado na API. A chave é privada; somente a linha de configuração pública deve ser copiada.

## Validação em redes diferentes

Mantenha o fornecedor no Wi-Fi e use o receptor no hotspot. Na tela Rede, confirme a conexão de controle com o relay e um endereço contendo `/p2p-circuit/`. Solicite uma música que não esteja no cache do receptor. O log deve indicar conexão via relay ou conexão direta após travessia do NAT. Confirme reprodução/download e SHA-256. Depois do período ocioso, a conexão de transferência deve encerrar; a reserva de controle permanece.

## Limites iniciais

128 reservas (1 por peer), 16 circuitos simultâneos (até 4 por peer), 128 MiB e 10 minutos por circuito. Rate limits padrão do libp2p também se aplicam. Circuitos que atingem limites são encerrados; o usuário pode tentar novamente. Esses limites não são uma franquia mensal de tráfego. Monitore o consumo de banda do servidor. O relay público não autentica contas da API.

A preferência é conexão direta, seguida de relay. DCUtR tenta promover a conexão para direta quando o NAT permite. Não há garantia de travessia de todo CGNAT. O relay é o caminho alternativo nesses casos.
