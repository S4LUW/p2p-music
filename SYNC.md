# Sincronização v1 — contrato para o futuro cliente SQLite

Conta e dispositivo têm UUIDs independentes do Peer ID. O servidor não armazena
caminhos locais, endereços de peers nem bytes de MP3. Identidade de arquivo:
SHA-256 lowercase com 64 caracteres. Nome/tamanho são metadados informados pelo
cliente, não comprovação de conteúdo; download continua verificando SHA-256.

## Enviar alterações

`POST /v1/sync`, autenticado, Content-Type application/json:

```json
{
  "operations": [
    {
      "operationId": "11ca486a-f405-4500-b650-755d12ac0456",
      "playlistId": "627334d4-3872-4ef0-85c7-c1d66228b3d2",
      "type": "create",
      "baseVersion": 0,
      "name": "Favoritas"
    }
  ]
}
```

Toda operação possui operationId, playlistId, type e baseVersion.

| type | Campos adicionais | Efeito |
|---|---|---|
| create | name | Cria; baseVersion deve ser 0 |
| rename | name | Renomeia |
| add | entry: {id: UUID, file: {id: SHA256, name, size}}, beforeId: UUID ou null | Insere antes da entrada; null/omitido adiciona no fim |
| remove | entryId | Remove uma entrada |
| move | entryId, beforeId: UUID ou null | Move antes de outra entrada; null move ao fim |
| delete | nenhum | Marca excluída, preservando entradas |
| restore | nenhum | Recupera uma playlist excluída |

Cada alteração incrementa version em um. Num lote create + add, use baseVersion
0 no create e 1 no add. Lotes são atômicos: qualquer conflito desfaz tudo.
409 contém a operação conflitante e, quando aplicável, o estado atual da playlist
da própria conta. Não altere a baseVersion e reenvie automaticamente sem resolver
a intenção local contra o novo estado.

Resposta: `{results:[{operationId,playlistId,version,revision}]}`.
Reenviar o mesmo operationId/conteúdo devolve o recibo anterior sem alterar dados.
Reutilizar operationId com outro conteúdo retorna 409. Após resolver um conflito
com conteúdo diferente, gere um novo operationId. Em timeout, reenvie os mesmos IDs
e conteúdo antes de considerar a operação perdida.

## Receber alterações

`GET /v1/sync?after=0` retorna:

```json
{
  "playlists": [],
  "nextCursor": "0",
  "hasMore": false
}
```

Cada playlist contém id, name, entries, version, revision, deletedAt e updatedAt.
São retornados snapshots atuais das playlists modificadas desde o cursor,
incluindo excluídas. O servidor agrupa múltiplas alterações na mesma playlist.
O push usa operações pequenas; o pull transfere a playlist alterada completa
nesta primeira versão, não toda a biblioteca nem cada evento intermediário.

Cursores/revisões são strings decimais para evitar perda de precisão em JavaScript.
Use somente nextCursor de um pull aplicado com sucesso como cursor de leitura.
**Nunca avance o cursor de pull a partir das revisões recebidas em um push**:
isso poderia pular alterações de outro dispositivo ainda não recebidas.
Enquanto hasMore for true, leia a próxima página. Não faça polling por segundo.

## Transações locais no SQLite (próxima etapa, ainda não implementada)

1. Separe estado confirmado pelo servidor e alterações locais pendentes por conta.
2. Cada edição salva a intenção e um operationId durável na outbox numa transação.
3. Ao abrir/retomar conexão, obtenha mudanças e preserve intenções locais pendentes.
4. Envie operações na ordem por playlist, agrupadas, com as versões confirmadas.
5. Grave confirmações e remova operações da outbox na mesma transação local.
6. Aplique cada página de pull e nextCursor atomicamente. Reaplique a prévia das
   intenções locais sobre o estado confirmado, sem apagar edições não enviadas.
7. Em 409, preserve a intenção e apresente resolução; em 401, peça login; em 429,
   respeite Retry-After. Para falhas de rede/5xx, use backoff com jitter (por exemplo,
   2 s até 5 min). Novas alterações podem ser agrupadas por uma janela curta.
8. Uma sincronização manual permite conferir novidades feitas em outro dispositivo.
   Para detectar mudanças enquanto aberto, um intervalo moderado configurável é
   suficiente no piloto; notificações podem ser acrescentadas quando necessário.

Não remova playlists locais apenas por ausência numa página incremental. Use
deletedAt. Não compartilhe cursor ou outbox entre contas. Logout deve esconder os
dados da conta e guardar pendências segregadas para um próximo login da mesma conta.
