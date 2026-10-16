# Descoberta e presença — piloto

Publicar esta versão da API antes de atualizar os desktops. Não exige migration nem novas variáveis de ambiente. Use uma única réplica da API no EasyPanel.

`POST /v1/network/heartbeat`, autenticado pelo Bearer existente:

```json
{"peerId":"identidade libp2p Ed25519", "protocolVersion":3, "addresses":["/ip4/IP/tcp/PORTA/p2p/IDENTIDADE"]}
```

Retorna `activePeers`, `ttlSeconds:180` e até oito `peers`, cada um com `peerId` e `addresses`. Não retorna conta, e-mail ou token. Máximo de oito endereços IPv4/TCP por nó e três avisos/minuto/dispositivo. Endereços privados/loopback/CGNAT são visíveis apenas para a mesma conta; públicos são visíveis para contas autenticadas. Identidade e endereço são anunciados pelo cliente; a conexão Noise verifica a identidade remota. O diretório não comprova alcance nem propriedade do IP.

O desktop anuncia presença aproximadamente a cada 65–70 segundos, com backoff até cinco minutos em falhas. Até quatro candidatos por rodada, com alvo de oito conexões automáticas; conexões manuais ou recebidas podem ultrapassar esse alvo. Não há malha completa. O número global inclui o solicitante e significa presença registrada nos últimos três minutos, não conectividade comprovada. Logout online remove a presença do dispositivo; fechamento, revogação e falha de rede dependem da expiração.

Registro em memória limitado a 10.000 nós, sem escrita de heartbeat no Postgres; a autenticação ainda consulta sessões no banco. Varreduras de expiração e seleção são limitadas pelo tamanho do registro. Reiniciar a API zera o contador até os clientes se anunciarem novamente. Não usar múltiplas réplicas sem transferir o registro para armazenamento compartilhado com TTL (por exemplo Redis). O limite existente de 600 requisições/minuto por socket do proxy continua sendo o limite prático do piloto, não uma promessa de capacidade para 10.000 usuários simultâneos.

Não implementa relay, hole punching, descoberta de IP público ou abertura de portas. Endereços anunciados precisam ser alcançáveis. Em redes distintas atrás de NAT, a descoberta pode encontrar o peer sem conseguir conectá-lo. Na mesma conta, endereços LAN de redes distintas podem não corresponder ao computador remoto; a autenticação P2P impede aceitar uma identidade diferente.

Validação: `npm test`; testes de autenticação HTTP, TTL, isolamento de endereços privados, limite de candidatos, colisão de identidade e capacidade. Nenhuma alteração de produção foi feita automaticamente.
