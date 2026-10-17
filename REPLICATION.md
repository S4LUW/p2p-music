# Cache colaborativo e replicação

## Política

- Por instalação/perfil: 5.000.000.000 bytes de áudio gerenciado, incluindo a reserva de uma transferência em andamento.
- Dentro desse total, até 3.000.000.000 bytes de réplicas preventivas. O cache de reprodução pode usar todo o restante.
- Uma cópia por SHA256. Ouvir uma réplica promove sua classificação a cache de reprodução, sem copiar o arquivo.
- Arquivos originais selecionados pelo curador ficam fora da gestão automática; nunca são apagados pelo cache. Downloads manuais antigos em `received` também são preservados e não são migrados automaticamente.
- Novos downloads manuais entram no cache e estão sujeitos ao descarte. Para guardar permanentemente uma cópia, copie-a para uma pasta pessoal.
- Reserva de 256 MB de espaço livre no disco. Limite defensivo de 4.000 arquivos gerenciados; compartilhamento de originais continua limitado a 32 registros.

## Desktop

`managed-audio` dentro dos dados locais de cada perfil contém arquivos nomeados pelo SHA256 e um manifesto atômico. O cache é restaurado e revalidado na abertura, sem enviar caminhos locais à API.

A reprodução desde o início grava os mesmos blocos recebidos, sem um segundo download. Somente arquivos completos, com tamanho e SHA256 verificados, são anunciados. Saltos e interrupções entram numa fila local limitada a 128 músicas; o app tenta completar essas músicas quando o leitor de áudio estiver ocioso. A fila não sobrevive ao encerramento e uma fonte desconectada pode impedir essa conclusão.

Há uma transferência gerenciada por vez. Transferências em segundo plano pausam enquanto o leitor de áudio busca dados, têm cadência máxima aproximada de 1 MB/s e podem ser canceladas na Biblioteca. O espaço total do arquivo é reservado antes da gravação; parciais são removidos ao cancelar/falhar e restos de um encerramento abrupto são limpos na abertura.

Para liberar espaço, o cache prefere arquivos com mais fontes informadas e uso mais antigo. Uma réplica preventiva só substitui outra se houver evidência de que a nova é mais rara; arquivos igualmente raros não ficam sendo trocados. Downloads para reprodução podem substituir a última opção quando necessário para respeitar o teto. Não se remove uma música apenas por ultrapassar 16 fontes.

## API

O heartbeat existente aceita inventário compacto de pares `[SHA256, tamanho]`, enviado somente quando muda. Após reinício da API, ela pede um novo inventário. Respostas incluem contagens e, opcionalmente, uma tarefa preventiva.

O coordenador em memória usa a presença com TTL de 180 segundos. Alvo: 16 fontes anunciadas online por música, somadas às reservas ainda pendentes para evitar tarefas duplicadas. Uma fonte nova precisa ser conhecida por pelo menos 30 segundos antes de motivar replicação. Cada destino recebe uma reserva; cada origem pode alimentar até duas reservas preventivas simultâneas. Reservas duram cinco minutos e são renovadas enquanto o destinatário informa a transferência ativa. Conclusão só conta como fonte no próximo inventário verificado do desktop.

Contagens da coordenação são declarações de dispositivos ativos, não provas de conectividade pública ou de máquinas físicas distintas. A lista visual de fontes do catálogo continua usando consultas diretas aos peers conectados. NAT/CGNAT continua pendente; falhas de conexão deixam a reserva expirar e não geram uma fonte confirmada localmente.

Nenhum MP3 passa pela API ou pelo PostgreSQL. Esta versão requer **uma réplica da API**, com limites de 10.000 presenças e 200.000 associações arquivo/dispositivo. O índice é reconstruído dos heartbeats; reiniciar a API perde somente presença e reservas temporárias. Escala maior exigirá substituir a coordenação em memória e otimizar o índice para múltiplas réplicas.

## Atualização e validação

1. Publicar as alterações da API pelo GitHub Desktop e executar Deploy no EasyPanel. Não há nova migração de banco.
2. Recompilar o desktop com `npm run desktop:build` e atualizar todos os participantes do teste. Clientes antigos têm limite de 32 ofertas P2P e não participam do novo inventário.
3. Abrir dois perfis autenticados. Compartilhar um MP3 no curador e deixar o outro ocioso, sem ouvir a música.
4. Aguardar os ciclos de presença (normalmente alguns minutos). O segundo perfil deve mostrar uma transferência, uso na reserva da rede e depois uma nova fonte.
5. Fechar o curador e consultar/reproduzir a réplica a partir de outro peer conectado.
6. Ouvir outra música desde o início: após o recebimento completo, ela aparece no cache de reprodução. Reabrir o app e conferir a restauração.

Testes automatizados: cotas com limites reduzidos, promoção sem duplicação, restauração, descarte preservando originais, integridade, parciais, reprodução por uma réplica após saída do publicador, reservas, teto de fontes e isolamento de endereços privados.
