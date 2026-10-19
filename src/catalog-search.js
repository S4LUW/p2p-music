// Literal substring search: parameters never become SQL or LIKE wildcards.
const accents = 'áàâãäéèêëíìîïóòôõöúùûüçñ';
const plain = 'aaaaaeeeeiiiiooooouuuucn';
const folded = column => `translate(lower(normalize(${column}, NFC)), '${accents}', '${plain}')`;
export async function catalogSearch(db, query, offset) {
  if (query.length < 2) return { items: [], nextOffset: null };
  const q = query.normalize('NFC').toLowerCase().replace(/[áàâãäéèêëíìîïóòôõöúùûüçñ]/g, c => plain[accents.indexOf(c)]);
  const rows = (await db.query(`
    WITH candidates AS (
      SELECT 'artist' AS kind, id, ${folded('name')} AS label, id AS artist_id, NULL::uuid AS album_id, NULL::uuid AS track_id FROM catalog_artists WHERE position($1 in ${folded('name')}) > 0
      UNION ALL
      SELECT 'album', id, ${folded('title')}, artist_id, id, NULL::uuid FROM catalog_albums WHERE position($1 in ${folded('title')}) > 0
      UNION ALL
      SELECT 'track', t.id, ${folded('t.title')}, a.artist_id, t.album_id, t.id FROM catalog_tracks t JOIN catalog_albums a ON a.id=t.album_id WHERE position($1 in ${folded('t.title')}) > 0
    ), ranked AS (
      SELECT *, CASE WHEN label=$1 THEN 0 WHEN position($1 in label)=1 THEN 1 ELSE 2 END AS relevance,
        CASE kind WHEN 'artist' THEN 0 WHEN 'album' THEN 1 ELSE 2 END AS category FROM candidates
    ), page AS (
      SELECT * FROM ranked ORDER BY relevance,category,label,id LIMIT 51 OFFSET $2
    )
    SELECT p.kind,
      json_build_object('id',r.id,'name',r.name,'biography',r.biography,'illustrationUrl',r.illustration_url,'version',r.version) AS artist,
      CASE WHEN a.id IS NOT NULL THEN json_build_object('id',a.id,'artistId',a.artist_id,'title',a.title,'releaseYear',a.release_year,'genre',a.genre,'illustrationUrl',a.illustration_url,'version',a.version) END AS album,
      CASE WHEN t.id IS NOT NULL THEN json_build_object('id',t.id,'albumId',t.album_id,'title',t.title,'discNumber',t.disc_number,'trackNumber',t.track_number,'durationSeconds',t.duration_seconds,'version',t.version,
        'file',json_build_object('id',t.file_hash,'name',t.file_name,'size',t.file_size)) END AS track
    FROM page p JOIN catalog_artists r ON r.id=p.artist_id LEFT JOIN catalog_albums a ON a.id=p.album_id LEFT JOIN catalog_tracks t ON t.id=p.track_id
    ORDER BY p.relevance,p.category,p.label,p.id
  `, [q, offset])).rows;
  return { items: rows.slice(0,50).map(row => row.kind === 'artist' ? { kind: row.kind, artist: row.artist } : row.kind === 'album' ? { kind: row.kind, artist: row.artist, album: row.album } : row), nextOffset: rows.length > 50 ? offset + 50 : null };
}
