import { z } from 'zod';
import { problem } from './sync.js';
import { catalogSearch } from './catalog-search.js';

const text = z.string().trim().min(1).max(200);
const base = { id: z.uuid(), version: z.number().int().min(0).max(2147483646) };
const file = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), name: z.string().min(1).max(255), size: z.number().int().min(1).max(104857600) }).strict();
const write = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('artist'), name: text, biography: z.string().trim().max(4000) }).strict(),
  z.object({ ...base, kind: z.literal('album'), artistId: z.uuid(), title: text, releaseYear: z.number().int().min(1000).max(2200).nullable(), genre: z.string().trim().max(100) }).strict(),
  z.object({ ...base, kind: z.literal('track'), albumId: z.uuid(), title: text, discNumber: z.number().int().min(1).max(99), trackNumber: z.number().int().min(1).max(999), durationSeconds: z.number().int().min(1).max(86400).nullable(), file }).strict(),
]);
const queries = {
 artist: `SELECT id,name,biography,version FROM catalog_artists`,
 album: `SELECT id,artist_id AS "artistId",title,release_year AS "releaseYear",genre,version FROM catalog_albums`,
 track: `SELECT id,album_id AS "albumId",title,disc_number AS "discNumber",track_number AS "trackNumber",duration_seconds AS "durationSeconds",json_build_object('id',file_hash,'name',file_name,'size',file_size) AS file,version FROM catalog_tracks`,
};
export async function catalogRead(db, accountId, params) {
  const kind = z.enum(['artist','album','track','search']).parse(params.get('kind') ?? 'artist');
  const offset = z.coerce.number().int().min(0).max(100000).parse(params.get('offset') ?? 0);
  const q = z.string().trim().max(100).parse(params.get('q') ?? '');
  if (kind === 'search') return catalogSearch(db, q, offset);
  const parent = kind === 'artist' ? null : z.uuid().parse(params.get('parent'));
  const curator = (await db.query('SELECT is_curator FROM accounts WHERE id=$1',[accountId])).rows[0]?.is_curator === true;
  const filter = kind === 'artist' ? `WHERE ($1='' OR position(lower($1) in lower(name))>0) ORDER BY lower(name),id` : kind === 'album' ? 'WHERE artist_id=$1 ORDER BY release_year DESC NULLS LAST,title,id' : 'WHERE album_id=$1 ORDER BY disc_number,track_number,id';
  const rows = (await db.query(`${queries[kind]} ${filter} LIMIT 51 OFFSET $2`, [parent ?? q, offset])).rows;
  return { curator, items: rows.slice(0,50), nextOffset: rows.length > 50 ? offset + 50 : null };
}
export async function catalogWrite(db, accountId, input) {
  return db.transaction(async client => {
    const account = (await client.query('SELECT is_curator FROM accounts WHERE id=$1 FOR SHARE',[accountId])).rows[0];
    if (account?.is_curator !== true) throw problem(403,'Esta conta não tem permissão de curadoria.');
    const data = write.parse(input);
    const table = { artist:'catalog_artists', album:'catalog_albums', track:'catalog_tracks' }[data.kind];
    const current = (await client.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`,[data.id])).rows[0];
    if (current ? current.version !== data.version : data.version !== 0) throw problem(409,'O cadastro foi alterado em outra sessão. Atualize a lista antes de editar novamente.');
    // Parent links remain stable so edits cannot silently move an album or a track.
    if (current && ((data.kind === 'album' && current.artist_id !== data.artistId) || (data.kind === 'track' && current.album_id !== data.albumId))) throw problem(400,'O vínculo com artista ou álbum não pode ser alterado.');
    const columns = data.kind === 'artist' ? ['name','biography'] : data.kind === 'album' ? ['artist_id','title','release_year','genre'] : ['album_id','title','disc_number','track_number','duration_seconds','file_hash','file_name','file_size'];
    const values = data.kind === 'artist' ? [data.name,data.biography] : data.kind === 'album' ? [data.artistId,data.title,data.releaseYear,data.genre] : [data.albumId,data.title,data.discNumber,data.trackNumber,data.durationSeconds,data.file.id,data.file.name,data.file.size];
    try {
      if (current) await client.query(`UPDATE ${table} SET ${columns.map((c,i)=>`${c}=$${i+2}`).join(',')},version=version+1,updated_by=$${values.length+2},updated_at=now() WHERE id=$1`,[data.id,...values,accountId]);
      else await client.query(`INSERT INTO ${table}(id,${columns.join(',')},updated_by) VALUES(${[data.id,...values,accountId].map((_,i)=>`$${i+1}`).join(',')})`,[data.id,...values,accountId]);
    } catch (error) {
      if (error.code === '23505') throw problem(409,'Já existe uma faixa nessa posição ou um cadastro com esse identificador. Atualize a lista.');
      if (error.code === '23503') throw problem(404,'Artista ou álbum não encontrado. Atualize a lista.');
      throw error;
    }
    return { item: (await client.query(`${queries[data.kind]} WHERE id=$1`,[data.id])).rows[0] };
  });
}
